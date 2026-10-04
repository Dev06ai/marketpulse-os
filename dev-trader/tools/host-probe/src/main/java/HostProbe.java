import java.io.IOException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONObject;

/** Read-only staging probe using the same OkHttp version as the Android app.
 * Uses the library's default headers and TLS validation. Never loads exchange
 * credentials or invokes an execution endpoint. */
public final class HostProbe {
    private final String origin;
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS).build();

    private HostProbe(String origin) {
        require(origin.matches("https://[A-Za-z0-9.-]+(?::[0-9]+)?"), "Invalid HTTPS origin");
        this.origin = origin;
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }

    private JSONObject get(String path) throws IOException {
        try (Response response = client.newCall(new Request.Builder().url(origin + path).build()).execute()) {
            require(response.isSuccessful(), path + " returned HTTP " + response.code());
            require(response.body() != null, "Missing response body");
            return new JSONObject(response.body().string());
        }
    }

    private void socket(String profile) throws Exception {
        LinkedBlockingQueue<JSONObject> packets = new LinkedBlockingQueue<>();
        WebSocket ws = client.newWebSocket(new Request.Builder()
            .url(origin.replace("https://", "wss://") + "/ws?profile=" + profile).build(),
            new WebSocketListener() {
                @Override public void onMessage(WebSocket socket, String text) {
                    try { packets.offer(new JSONObject(text)); }
                    catch (RuntimeException error) { packets.offer(new JSONObject().put("probe_error", "Invalid JSON")); }
                }
                @Override public void onFailure(WebSocket socket, Throwable error, Response response) {
                    packets.offer(new JSONObject().put("probe_error", error.getClass().getSimpleName()));
                }
            });
        try {
            JSONObject first = packets.poll(15, TimeUnit.SECONDS);
            require(first != null, profile + " socket timed out");
            require(profile.equals(first.optString("profile")), profile + " socket did not return its profile");
            require(first.has("execution") == profile.equals("dashboard"), "Incorrect account payload scope");
            require(ws.send("{\"type\":\"keepalive\"}"), "Keepalive send failed");
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(12);
            boolean acknowledged = false;
            while (System.nanoTime() < deadline) {
                JSONObject packet = packets.poll(2, TimeUnit.SECONDS);
                if (packet == null) continue;
                require(!packet.has("probe_error"), profile + " socket failed");
                if ("ack".equals(packet.optString("type"))) { acknowledged = true; break; }
            }
            require(acknowledged, profile + " keepalive timed out");
        } finally { ws.close(1000, "Probe complete"); ws.cancel(); }
    }

    private void run() throws Exception {
        JSONObject health = get("/health");
        require(health.getBoolean("ok"), "Backend health failed");
        JSONObject checks = get("/system-check");
        require(checks.getBoolean("backend_ok"), "Backend system check failed");
        require(checks.getJSONObject("decision_journal").getBoolean("ready"), "Journal is unavailable");
        socket("dashboard");
        socket("alerts");
        JSONObject bootstrap = get("/bootstrap?profile=dashboard");
        require(bootstrap.getJSONObject("chart").getJSONArray("candles").length() > 0, "Missing chart history");
        require("BITGET_WS".equals(bootstrap.getJSONObject("upstream").getString("source")), "Exchange source is not WebSocket");
        JSONObject heartbeat = get("/heartbeat");
        require(heartbeat.getBoolean("market_ws"), "Exchange WebSocket is disconnected");
        require("HEALTHY".equals(heartbeat.getString("data_health")), "Market data is stale");
        long age = heartbeat.getJSONObject("ages_ms").getLong("received_ms");
        require(age >= 0 && age < 8000, "Exchange receipt is stale");
        System.out.println(new JSONObject().put("http", "PASS").put("tls", "PASS")
            .put("dashboard_ws", "PASS").put("alerts_ws", "PASS").put("keepalive", "PASS")
            .put("chart_history", "PASS").put("journal", "PASS").put("live_bitget_feed", "PASS")
            .put("feed_age_ms", age).put("engine_revision", health.getString("engine_revision")));
    }

    public static void main(String[] args) throws Exception {
        require(args.length == 1, "Supply one HTTPS origin");
        HostProbe probe = new HostProbe(args[0]);
        try { probe.run(); }
        finally {
            probe.client.dispatcher().executorService().shutdownNow();
            probe.client.connectionPool().evictAll();
        }
    }
}
