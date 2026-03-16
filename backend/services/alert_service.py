"""
System Alert Service
Every 5 minutes the scheduler calls check_and_send_alerts().
Sends an HTML email to ALERT_RECIPIENTS when any health threshold is breached.
Same alert key is suppressed for 2 hours to avoid spam.
"""
import logging
import time
from datetime import datetime

logger = logging.getLogger(__name__)

# ── Recipients ───────────────────────────────────────────────────────
ALERT_RECIPIENTS = ["jay.chiang@leadman.com"]

# ── Thresholds ───────────────────────────────────────────────────────
MEMORY_WARN_PCT  = 85   # %
CPU_WARN_PCT     = 90   # %
DB_CONN_WARN_PCT = 80   # % of max_connections

# ── Cooldown: same alert key won't re-send within 2 hours ────────────
_COOLDOWN_SECONDS = 7_200
_last_sent: dict[str, float] = {}


def _due(key: str) -> bool:
    return (time.time() - _last_sent.get(key, 0)) >= _COOLDOWN_SECONDS


def _mark(key: str):
    _last_sent[key] = time.time()


# ═══════════════════════════════════════════════════════════════════════
# Individual health checks
# ═══════════════════════════════════════════════════════════════════════

def _check_memory() -> list[dict]:
    try:
        import psutil
        m = psutil.virtual_memory()
        if m.percent > MEMORY_WARN_PCT:
            used  = round(m.used  / 1024 ** 3, 1)
            total = round(m.total / 1024 ** 3, 1)
            return [{"key": "memory_high", "level": "warning", "icon": "💾",
                     "title": "High Memory Usage",
                     "detail": f"{m.percent}%  ({used} GB / {total} GB used)"}]
    except Exception:
        pass
    return []


def _check_cpu() -> list[dict]:
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.5)
        if cpu > CPU_WARN_PCT:
            return [{"key": "cpu_high", "level": "warning", "icon": "⚡",
                     "title": "High CPU Usage",
                     "detail": f"CPU at {cpu}%"}]
    except Exception:
        pass
    return []


def _check_database() -> list[dict]:
    alerts = []
    try:
        from core.pg import get_cursor

        SCHEMAS = ["pcba", "assembly", "model", "auth",
                   "downtime", "documents", "monitor", "qc"]
        broken = []
        for schema in SCHEMAS:
            try:
                with get_cursor(schema) as cur:
                    cur.execute("SELECT 1")
            except Exception:
                broken.append(schema)

        if broken:
            alerts.append({
                "key": "db_unhealthy",
                "level": "critical", "icon": "🗄️",
                "title": "Database Schema(s) Unhealthy",
                "detail": f"Cannot connect to: {', '.join(broken)}",
            })

        # DB connection saturation
        with get_cursor("monitor") as cur:
            cur.execute(
                "SELECT setting::int AS mx FROM pg_settings "
                "WHERE name = 'max_connections'"
            )
            mx = (cur.fetchone() or {}).get("mx") or 1
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM pg_stat_activity "
                "WHERE datname = current_database()"
            )
            cnt = (cur.fetchone() or {}).get("cnt") or 0

        pct = round(cnt / mx * 100, 1)
        if pct > DB_CONN_WARN_PCT:
            alerts.append({
                "key": "db_conn_high",
                "level": "warning", "icon": "🔌",
                "title": "High DB Connection Usage",
                "detail": f"{cnt}/{mx} connections ({pct}%)",
            })

    except Exception as e:
        logger.warning("Alert DB check failed: %s", e)

    return alerts


def _check_docker() -> list[dict]:
    alerts = []
    try:
        import docker as _docker
        client = _docker.DockerClient(
            base_url="unix:///var/run/docker.sock", timeout=5
        )
        all_containers = client.containers.list(all=True)
        client.close()

        for c in all_containers:
            if "leadman" not in c.name:
                continue
            if c.status == "exited":
                alerts.append({
                    "key": f"container_stopped:{c.name}",
                    "level": "critical", "icon": "🐳",
                    "title": f"Container Stopped: {c.name}",
                    "detail": (
                        f"Container '{c.name}' is in 'exited' state. "
                        "Restart with: docker compose up -d"
                    ),
                })
    except Exception as e:
        logger.warning("Alert Docker check failed: %s", e)

    return alerts


def collect_alerts() -> list[dict]:
    """Run all health checks and return a list of active alerts."""
    alerts: list[dict] = []
    alerts.extend(_check_memory())
    alerts.extend(_check_cpu())
    alerts.extend(_check_database())
    alerts.extend(_check_docker())
    return alerts


# ═══════════════════════════════════════════════════════════════════════
# Email HTML builder
# ═══════════════════════════════════════════════════════════════════════

def _build_html(alerts: list[dict], checked_at: str) -> str:
    rows = ""
    for a in alerts:
        color = "#dc2626" if a["level"] == "critical" else "#d97706"
        bg    = "#fef2f2" if a["level"] == "critical" else "#fffbeb"
        rows += f"""
        <tr style="background:{bg};">
          <td style="padding:14px 16px;font-size:24px;width:44px;
                     vertical-align:top;">{a["icon"]}</td>
          <td style="padding:14px 16px;vertical-align:top;">
            <div style="color:{color};font-weight:700;font-size:13px;
                        text-transform:uppercase;letter-spacing:.6px;
                        margin-bottom:4px;">{a["title"]}</div>
            <div style="color:#4b5563;font-size:13px;line-height:1.5;">
              {a["detail"]}
            </div>
          </td>
        </tr>
        <tr><td colspan="2"
              style="height:1px;background:#e5e7eb;padding:0;"></td></tr>
        """

    n_crit = sum(1 for a in alerts if a["level"] == "critical")
    n_warn = len(alerts) - n_crit
    badges = ""
    if n_crit:
        badges += (
            f'<span style="background:#dc2626;color:white;border-radius:6px;'
            f'padding:3px 10px;font-size:12px;font-weight:700;'
            f'margin-right:6px;">{n_crit} Critical</span>'
        )
    if n_warn:
        badges += (
            f'<span style="background:#d97706;color:white;border-radius:6px;'
            f'padding:3px 10px;font-size:12px;font-weight:700;">'
            f'{n_warn} Warning</span>'
        )

    return f"""<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;
             font-family:Inter,-apple-system,Arial,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:white;
            border-radius:12px;overflow:hidden;
            box-shadow:0 4px 20px rgba(0,0,0,.10);">

  <!-- Header -->
  <div style="background:#1c1917;padding:24px 28px;">
    <div style="font-size:20px;font-weight:800;color:white;
                letter-spacing:-.4px;">🚨 Leadman System Alert</div>
    <div style="color:#a8a29e;font-size:13px;margin-top:6px;">
      Detected at {checked_at} (Server Time)
    </div>
    <div style="margin-top:12px;">{badges}</div>
  </div>

  <!-- Alert table -->
  <div style="padding:20px 28px 4px;">
    <p style="color:#374151;font-size:14px;margin:0 0 14px;">
      <strong>{len(alerts)}</strong> issue(s) require your attention:
    </p>
    <table style="width:100%;border-collapse:collapse;
                  border:1px solid #e5e7eb;border-radius:8px;
                  overflow:hidden;">
      <tbody>{rows}</tbody>
    </table>
  </div>

  <!-- Footer -->
  <div style="padding:16px 28px 24px;">
    <p style="color:#9ca3af;font-size:11px;margin:0;
              border-top:1px solid #f3f4f6;padding-top:12px;">
      Leadman FWH System &middot; System Monitor &middot;
      Alerts check every 5 minutes &middot;
      Same alert suppressed for 2 hours after first send.
    </p>
  </div>

</div>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════════════
# Main entry point (called by scheduler)
# ═══════════════════════════════════════════════════════════════════════

def check_and_send_alerts(email_service) -> int:
    """
    Collect active alerts, filter out suppressed ones, send email.
    Returns number of alerts included in the sent email (0 = nothing sent).
    """
    all_alerts = collect_alerts()
    if not all_alerts:
        return 0

    to_send = [a for a in all_alerts if _due(a["key"])]
    if not to_send:
        return 0

    checked_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    n_crit = sum(1 for a in to_send if a["level"] == "critical")
    subject = (
        f"🚨 [CRITICAL] Leadman System — {len(to_send)} alert(s) detected"
        if n_crit
        else f"⚠️ [WARNING] Leadman System — {len(to_send)} alert(s) detected"
    )

    try:
        ok = email_service.send_email(
            recipients=ALERT_RECIPIENTS,
            subject=subject,
            html_content=_build_html(to_send, checked_at),
        )
        if ok:
            for a in to_send:
                _mark(a["key"])
            logger.info("System alert sent: %d alert(s) → %s",
                        len(to_send), ALERT_RECIPIENTS)
        return len(to_send) if ok else 0
    except Exception as e:
        logger.error("Alert email send failed: %s", e)
        return 0
