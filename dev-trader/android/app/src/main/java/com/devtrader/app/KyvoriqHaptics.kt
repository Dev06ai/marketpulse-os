package com.devtrader.app

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * KYVORIQ's tactile language.
 *
 * Uses Android's semantic haptic primitives instead of raw vibration patterns so
 * each phone can map the cue onto its own haptic hardware. performHapticFeedback
 * also respects the user's system haptic setting and requires no vibration
 * permission.
 */
object KyvoriqHaptics {
    enum class Cue {
        TAP,
        SELECT,
        ACTION,
        CONFIRM,
        REJECT,
        DRAG_START,
        DRAG_END,
    }

    fun fire(view: View?, cue: Cue) {
        val target = view ?: return
        if (!target.isEnabled || !target.isHapticFeedbackEnabled) return

        val constant = when (cue) {
            Cue.TAP -> HapticFeedbackConstants.KEYBOARD_TAP
            Cue.SELECT -> if (Build.VERSION.SDK_INT >= 34) {
                HapticFeedbackConstants.SEGMENT_TICK
            } else {
                HapticFeedbackConstants.CLOCK_TICK
            }
            Cue.ACTION -> HapticFeedbackConstants.CONTEXT_CLICK
            Cue.CONFIRM -> if (Build.VERSION.SDK_INT >= 30) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.CONTEXT_CLICK
            }
            Cue.REJECT -> if (Build.VERSION.SDK_INT >= 30) {
                HapticFeedbackConstants.REJECT
            } else {
                HapticFeedbackConstants.LONG_PRESS
            }
            Cue.DRAG_START -> if (Build.VERSION.SDK_INT >= 30) {
                HapticFeedbackConstants.GESTURE_START
            } else {
                HapticFeedbackConstants.CONTEXT_CLICK
            }
            Cue.DRAG_END -> if (Build.VERSION.SDK_INT >= 30) {
                HapticFeedbackConstants.GESTURE_END
            } else {
                HapticFeedbackConstants.VIRTUAL_KEY
            }
        }
        target.performHapticFeedback(constant)
    }

    fun frequentTick(view: View?) {
        val target = view ?: return
        if (!target.isEnabled || !target.isHapticFeedbackEnabled) return
        val constant = if (Build.VERSION.SDK_INT >= 34) {
            HapticFeedbackConstants.SEGMENT_FREQUENT_TICK
        } else {
            HapticFeedbackConstants.CLOCK_TICK
        }
        target.performHapticFeedback(constant)
    }
}
