import { ImageResponse } from "next/og";

export const alt = "SignalMend incident response and webhook platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background:
            "radial-gradient(circle at 75% 20%, #4338ca 0, transparent 38%), linear-gradient(135deg, #080b13 0%, #111827 100%)",
          color: "#f8fafc",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              display: "flex",
              width: "54px",
              height: "54px",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "16px",
              background: "#6366f1",
              fontSize: "30px",
              fontWeight: 700,
            }}
          >
            S
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700 }}>SignalMend</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              color: "#a5b4fc",
              fontSize: "20px",
              fontWeight: 700,
              letterSpacing: "5px",
            }}
          >
            INCIDENT RESPONSE, WITHOUT THE NOISE
          </div>
          <div
            style={{
              maxWidth: "1000px",
              fontSize: "68px",
              fontWeight: 700,
              lineHeight: 1.08,
            }}
          >
            Turn webhooks into clear, actionable incidents.
          </div>
          <div style={{ color: "#cbd5e1", fontSize: "26px" }}>
            Verify incoming events. Route the right alerts to your team.
          </div>
        </div>
        <div style={{ color: "#94a3b8", fontSize: "20px" }}>signalmend.com</div>
      </div>
    ),
    { ...size },
  );
}
