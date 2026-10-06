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

    private JSONObject waitForConfidenceSizing() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(180);
        String lastPolicy = "";
        while (System.nanoTime() < deadline) {
            JSONObject bootstrap = get("/bootstrap?profile=dashboard");
            JSONObject execution = bootstrap.optJSONObject("execution");
            JSONObject summary = execution != null ? execution.optJSONObject("summary") : null;
            if (summary != null) {
                lastPolicy = summary.optString("execution_policy", "");
                JSONObject sizing = summary.optJSONObject("margin_sizing");
                if ("CONFIDENCE_MARGIN_20X_FEE_ADJUSTED".equals(lastPolicy)
                    && summary.optInt("leverage", 0) == 20
                    && sizing != null
                    && sizing.optDouble("medium_min_usdt", -1) == 50.0
                    && sizing.optDouble("medium_max_usdt", -1) == 75.0
                    && sizing.optDouble("high_min_usdt", -1) == 76.0
                    && sizing.optDouble("high_max_usdt", -1) == 100.0) {
                    return summary;
                }
            }
            Thread.sleep(5000);
        }
        throw new IllegalStateException("Live host did not converge to confidence-sized 20x execution; last policy=" + lastPolicy);
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

    private void run(boolean requireConfidenceSizing) throws Exception {
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
        JSONObject executionSummary = requireConfidenceSizing
            ? waitForConfidenceSizing()
            : bootstrap.optJSONObject("execution").optJSONObject("summary");
        // Demo depth updates can pause while ticker packets keep arriving.
        // Observe a full minute, report those intervals, and retain the engine's
        // unchanged entry gate. Socket liveness alone is never entry readiness.
        int healthy = 0, degraded = 0;
        long age = 0, maxBookAge = 0;
        for (int sample = 0; sample <= 20; sample++) {
            if (sample > 0) Thread.sleep(3000);
            JSONObject heartbeat = get("/heartbeat");
            require(heartbeat.getBoolean("market_ws"), "Exchange WebSocket is disconnected");
            String status = heartbeat.getString("data_health");
            require("HEALTHY".equals(status) || "DEGRADED".equals(status), "Market feed is stale: " + status);
            if ("HEALTHY".equals(status)) healthy++; else degraded++;
            age = heartbeat.getJSONObject("ages_ms").getLong("received_ms");
            require(age >= 0 && age < 8000, "Exchange receipt is stale");
            maxBookAge = Math.max(maxBookAge, heartbeat.getJSONObject("ages_ms").getLong("book_ms"));
        }
        require(healthy > 0, "No fully fresh demo market snapshot observed in one minute");
        System.out.println(new JSONObject().put("http", "PASS").put("tls", "PASS")
            .put("dashboard_ws", "PASS").put("alerts_ws", "PASS").put("keepalive", "PASS")
            .put("chart_history", "PASS").put("journal", "PASS").put("live_bitget_feed", "PASS")
            .put("feed_age_ms", age).put("healthy_samples", healthy).put("degraded_samples", degraded)
            .put("max_book_age_ms", maxBookAge).put("entry_freshness_gate", "UNCHANGED")
            .put("execution_policy", executionSummary != null ? executionSummary.optString("execution_policy", "UNKNOWN") : "UNKNOWN")
            .put("execution_leverage", executionSummary != null ? executionSummary.optInt("leverage", 0) : 0)
            .put("confidence_sizing_required", requireConfidenceSizing)
            .put("medium_margin_usdt", requireConfidenceSizing ? "50-75" : "NOT_REQUIRED")
            .put("high_margin_usdt", requireConfidenceSizing ? "76-100" : "NOT_REQUIRED")
            .put("engine_revision", health.getString("engine_revision")));
    }

    public static void main(String[] args) throws Exception {
        require(args.length == 1 || args.length == 2, "Supply one HTTPS origin and optional --require-confidence-sizing");
        boolean requireConfidenceSizing = args.length == 2;
        if (requireConfidenceSizing) {
            require("--require-confidence-sizing".equals(args[1]), "Unknown host-probe option");
        }
        HostProbe probe = new HostProbe(args[0]);
        try { probe.run(requireConfidenceSizing); }
        finally {
            probe.client.dispatcher().executorService().shutdownNow();
            probe.client.connectionPool().evictAll();
        }
    }
}
