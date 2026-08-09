package com.groenewold.loadout;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

/**
 * The floating rest-timer bubble.
 *
 * Drawn by hand rather than rendered by the OS, because the behaviour we want
 * is beyond what a notification can express: a progress ring, and a switch to
 * red with a count-UP once the rest period is over. Progression does exactly
 * this, which is why its notification carries showChronometer=false.
 *
 * Draggable, and taps through to the app.
 */
@SuppressLint("ViewConstructor")
public class TimerOverlayView extends View {

    private static final int COLOR_BG = Color.parseColor("#E6141414");
    private static final int COLOR_RING_TRACK = Color.parseColor("#33FFFFFF");
    private static final int COLOR_RING = Color.parseColor("#FFFFFFFF");
    private static final int COLOR_OVER = Color.parseColor("#FFEF4444");

    private final Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint trackPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF arcBounds = new RectF();

    private long endsAt;
    private long totalMs;

    /** Set by the service so a tap can bring the app forward. */
    public Runnable onTap;

    private final WindowManager windowManager;
    private final WindowManager.LayoutParams params;

    // Drag state
    private float downRawX, downRawY;
    private int downX, downY;
    private boolean dragged;
    private final int touchSlop;

    public TimerOverlayView(
        Context context,
        WindowManager windowManager,
        WindowManager.LayoutParams params
    ) {
        super(context);
        this.windowManager = windowManager;
        this.params = params;
        this.touchSlop = android.view.ViewConfiguration.get(context).getScaledTouchSlop();

        float density = getResources().getDisplayMetrics().density;
        bgPaint.setColor(COLOR_BG);
        trackPaint.setStyle(Paint.Style.STROKE);
        trackPaint.setStrokeWidth(5 * density);
        trackPaint.setColor(COLOR_RING_TRACK);
        ringPaint.setStyle(Paint.Style.STROKE);
        ringPaint.setStrokeWidth(5 * density);
        ringPaint.setStrokeCap(Paint.Cap.ROUND);
        ringPaint.setColor(COLOR_RING);
        textPaint.setColor(Color.WHITE);
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTextSize(22 * density);
        textPaint.setFakeBoldText(true);
    }

    public void setTimer(long endsAt, long totalMs) {
        this.endsAt = endsAt;
        this.totalMs = Math.max(totalMs, 1);
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        float density = getResources().getDisplayMetrics().density;
        float w = getWidth(), h = getHeight();
        float cx = w / 2f, cy = h / 2f;
        float inset = 6 * density;
        float radius = Math.min(w, h) / 2f - inset;

        long remaining = endsAt - System.currentTimeMillis();
        boolean over = remaining <= 0;

        canvas.drawCircle(cx, cy, radius, bgPaint);

        arcBounds.set(cx - radius, cy - radius, cx + radius, cy + radius);
        canvas.drawArc(arcBounds, -90, 360, false, trackPaint);

        if (!over) {
            // Ring drains clockwise as the rest period elapses.
            float fraction = Math.min(1f, Math.max(0f, remaining / (float) totalMs));
            ringPaint.setColor(COLOR_RING);
            canvas.drawArc(arcBounds, -90, 360 * fraction, false, ringPaint);
        } else {
            ringPaint.setColor(COLOR_OVER);
            canvas.drawArc(arcBounds, -90, 360, false, ringPaint);
        }

        textPaint.setColor(over ? COLOR_OVER : Color.WHITE);
        // Past zero the timer counts UP, so the display keeps meaning something
        // when you glance at it late rather than freezing at 0:00.
        long shown = Math.abs(over ? -remaining : remaining);
        long totalSeconds = (shown + 999) / 1000;
        String label = String.format(
            java.util.Locale.US,
            "%s%d:%02d",
            over ? "+" : "",
            totalSeconds / 60,
            totalSeconds % 60
        );

        Paint.FontMetrics fm = textPaint.getFontMetrics();
        float baseline = cy - (fm.ascent + fm.descent) / 2f;
        canvas.drawText(label, cx, baseline, textPaint);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                downX = params.x;
                downY = params.y;
                dragged = false;
                return true;

            case MotionEvent.ACTION_MOVE: {
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                if (!dragged && Math.hypot(dx, dy) > touchSlop) dragged = true;
                if (dragged) {
                    params.x = downX + (int) dx;
                    params.y = downY + (int) dy;
                    windowManager.updateViewLayout(this, params);
                }
                return true;
            }

            case MotionEvent.ACTION_UP:
                if (!dragged && onTap != null) onTap.run();
                return true;
        }
        return super.onTouchEvent(event);
    }
}
