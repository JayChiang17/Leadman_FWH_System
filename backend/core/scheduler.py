"""
Scheduler - Automated Task Scheduler
Uses APScheduler to manage scheduled tasks including daily production reports.
"""

import os
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

# Add parent directory to path for service imports
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from services.email_service import GraphAPIEmailService
from services.data_collection_service import DataCollectionService
from services.alert_service import check_and_send_alerts
from core.email_db import (
    init_email_tables,
    get_email_config,
    get_active_recipients,
    log_email_send,
)
from core.paths import DATA_DIR


class ReportScheduler:
    """Report Scheduler - Manages all scheduled tasks."""

    def __init__(self, emit_init_log: bool = True):
        self.scheduler = BackgroundScheduler()
        self.email_service = GraphAPIEmailService()
        self.data_service = DataCollectionService()
        self._emit_init_log = emit_init_log
        default_lock = DATA_DIR / "scheduler.lock"
        if "unittest" in sys.modules or os.getenv("PYTEST_CURRENT_TEST"):
            default_lock = DATA_DIR / f"scheduler.test.{os.getpid()}.lock"
        self._lock_enabled = os.getenv("SCHEDULER_LOCK_ENABLED", "1") != "0"
        self._lock_file = Path(os.getenv("SCHEDULER_LOCK_FILE", str(default_lock)))
        self._lock_fd = None
        self._is_leader = False

        try:
            init_email_tables()
        except Exception as e:
            self._log("WARN", f"failed to initialize email tables: {e}")

        self._load_scheduler_runtime_options()
        self._load_config()

        if self._emit_init_log:
            self._log("INFO", "scheduler initialized")
            self._log("INFO", f"daily report time: {self.report_time}")
            self._log("INFO", f"daily report enabled: {self.enabled}")
            self._log("INFO", f"recipients: {self._recipients_summary()}")
            self._log(
                "INFO",
                (
                    "scheduler runtime options: "
                    f"misfire_grace_time={self.misfire_grace_seconds}s, "
                    f"coalesce={self.coalesce}, max_instances={self.max_instances}"
                ),
            )

    def _log(self, level: str, message: str):
        print(f"[{level:<5}] {message}")

    def _load_scheduler_runtime_options(self):
        """Load runtime options that affect missed-run handling and concurrency."""
        try:
            grace = int(os.getenv("SCHEDULER_MISFIRE_GRACE_SECONDS", "90"))
        except (TypeError, ValueError):
            grace = 90
        self.misfire_grace_seconds = max(5, min(grace, 3600))

        self.coalesce = os.getenv("SCHEDULER_COALESCE", "1") != "0"

        try:
            max_instances = int(os.getenv("SCHEDULER_MAX_INSTANCES", "1"))
        except (TypeError, ValueError):
            max_instances = 1
        self.max_instances = max(1, min(max_instances, 5))

    @staticmethod
    def _extract_production_counts(report_data: dict) -> tuple[int, int]:
        module_count = int(
            report_data.get("module_production", report_data.get("module_count", 0)) or 0
        )
        assembly_count = int(
            report_data.get("assembly_production", report_data.get("assembly_count", 0)) or 0
        )
        return module_count, assembly_count

    @property
    def is_leader(self) -> bool:
        return self._is_leader

    def _acquire_leader_lock(self) -> bool:
        if not self._lock_enabled:
            self._is_leader = True
            return True

        if self._lock_fd is not None:
            return self._is_leader

        self._lock_file.parent.mkdir(parents=True, exist_ok=True)
        self._lock_fd = open(self._lock_file, "a+b")
        self._lock_fd.seek(0)
        self._lock_fd.write(b"1")
        self._lock_fd.flush()

        try:
            if os.name == "nt":
                import msvcrt
                self._lock_fd.seek(0)
                msvcrt.locking(self._lock_fd.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._lock_fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._is_leader = True
            return True
        except Exception:
            try:
                self._lock_fd.close()
            except Exception:
                pass
            self._lock_fd = None
            self._is_leader = False
            return False

    def _release_leader_lock(self):
        if not self._lock_enabled:
            self._is_leader = False
            return
        if self._lock_fd is None:
            self._is_leader = False
            return
        try:
            if os.name == "nt":
                import msvcrt
                self._lock_fd.seek(0)
                msvcrt.locking(self._lock_fd.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._lock_fd.fileno(), fcntl.LOCK_UN)
        except Exception:
            pass
        try:
            self._lock_fd.close()
        except Exception:
            pass
        self._lock_fd = None
        self._is_leader = False

    def _parse_recipients(self, recipients_str: str) -> list:
        if not recipients_str:
            return []
        return [email.strip() for email in recipients_str.split(",") if email.strip()]

    def _recipients_summary(self, preview_limit: int = 3) -> str:
        if not self.recipients:
            return "0 recipients"
        count = len(self.recipients)
        preview = ", ".join(self.recipients[:preview_limit])
        if count > preview_limit:
            preview = f"{preview}, +{count - preview_limit} more"
        return f"{count} recipients ({preview})"

    def _load_config(self):
        """Load configuration from database with fallback to environment variables."""
        try:
            config = get_email_config()
            if config:
                self.report_time = config["send_time"]
                self.enabled = bool(config["enabled"])
            else:
                self.report_time = os.getenv("REPORT_SEND_TIME", "18:00")
                self.enabled = True

            recipient_list = get_active_recipients()
            if recipient_list:
                self.recipients = [r["email"] for r in recipient_list]
            else:
                self.recipients = self._parse_recipients(os.getenv("DAILY_REPORT_EMAILS", ""))

        except Exception as e:
            self._log("WARN", f"failed to load config from database: {e}")
            self.report_time = os.getenv("REPORT_SEND_TIME", "18:00")
            self.recipients = self._parse_recipients(os.getenv("DAILY_REPORT_EMAILS", ""))
            self.enabled = True

    def send_daily_report(self):
        """Daily report task function called by scheduler."""
        print("\n" + "=" * 70)
        self._log("INFO", f"daily report run started at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 70)

        try:
            self._load_config()

            if not self.enabled:
                self._log("INFO", "email sending disabled in configuration")
                print("=" * 70 + "\n")
                return

            if not self.recipients:
                self._log("WARN", "no recipients configured")
                print("=" * 70 + "\n")
                return

            self._log("INFO", "step 1/2 collecting data")
            report_data = self.data_service.get_daily_report_data()
            module_count, assembly_count = self._extract_production_counts(report_data)

            # Retry full data once if collector reported error (common transient case: DB lock)
            if report_data.get("error"):
                self._log("WARN", f"daily report collection error, retry once: {report_data.get('error')}")
                time.sleep(0.5)
                retry_data = self.data_service.get_daily_report_data()
                if not retry_data.get("error"):
                    report_data = retry_data
                    module_count, assembly_count = self._extract_production_counts(report_data)
                    self._log("INFO", "daily report collection recovered after retry")

            # Final guard: never skip by relying only on full report payload.
            if module_count == 0 and assembly_count == 0:
                try:
                    fallback = self.data_service.get_today_production_counts()
                    fb_module, fb_assembly = self._extract_production_counts(fallback)
                    module_count = max(module_count, fb_module)
                    assembly_count = max(assembly_count, fb_assembly)
                    report_data["module_production"] = module_count
                    report_data["assembly_production"] = assembly_count
                    self._log(
                        "INFO",
                        f"fallback production counts checked: module={module_count}, assembly={assembly_count}",
                    )
                except Exception as e:
                    self._log("WARN", f"fallback production count check failed: {e}")

            if module_count == 0 and assembly_count == 0:
                self._log("INFO", "no production data today (module=0, assembly=0), skip email")
                try:
                    log_email_send(
                        recipients=self.recipients,
                        status="skipped",
                        error_message="No production data today (module=0, assembly=0)",
                        triggered_by="scheduler:daily_report",
                    )
                except Exception:
                    pass
                print("=" * 70 + "\n")
                return

            self._log("INFO", "step 2/2 sending email")
            success = self.email_service.send_daily_report(
                recipients=self.recipients,
                report_data=report_data,
            )

            try:
                log_email_send(
                    recipients=self.recipients,
                    status="success" if success else "failed",
                    error_message=None if success else "Email send failed",
                    triggered_by="scheduler:daily_report",
                )
            except Exception as log_error:
                self._log("WARN", f"failed to log email send: {log_error}")

            print("\n" + "=" * 70)
            if success:
                self._log("OK", "daily report sent successfully")
            else:
                self._log("ERROR", "daily report sending failed")
            print("=" * 70 + "\n")

        except Exception as e:
            self._log("ERROR", f"error while sending daily report: {e}")
            print("=" * 70 + "\n")

            try:
                log_email_send(
                    recipients=self.recipients if hasattr(self, "recipients") else [],
                    status="error",
                    error_message=str(e),
                    triggered_by="scheduler:daily_report",
                )
            except Exception as log_error:
                self._log("WARN", f"failed to log email error: {log_error}")

    def send_system_alerts(self):
        """Health-check task called every 5 minutes by scheduler."""
        try:
            n = check_and_send_alerts(self.email_service)
            if n:
                self._log("OK", f"system alert email sent: {n} alert(s)")
        except Exception as e:
            self._log("ERROR", f"system alert check failed: {e}")

    def start(self, quiet: bool = False) -> bool:
        """Start scheduler."""
        if not self._acquire_leader_lock():
            if not quiet:
                self._log("INFO", f"scheduler lock held by another worker, skip start ({self._lock_file})")
            return False

        # ── System health alerts every 5 minutes (always active) ─────────
        self.scheduler.add_job(
            func=self.send_system_alerts,
            trigger=IntervalTrigger(minutes=5),
            id="system_alerts",
            name="System Health Alerts",
            replace_existing=True,
            misfire_grace_time=self.misfire_grace_seconds,
            max_instances=1,
            coalesce=True,
        )
        if not quiet:
            self._log("OK", "system health alert check configured (every 5 min)")

        if not self.enabled:
            if not quiet:
                self._log("INFO", "email sending disabled in configuration")
        elif not self.recipients:
            if not quiet:
                self._log("WARN", "daily report recipients not configured")
        else:
            try:
                hour, minute = map(int, self.report_time.split(":"))
            except (ValueError, AttributeError):
                if not quiet:
                    self._log("WARN", f"invalid send time format: {self.report_time}, fallback to 18:00")
                hour, minute = 18, 0

            ca_tz = ZoneInfo("America/Los_Angeles")
            self.scheduler.add_job(
                func=self.send_daily_report,
                trigger=CronTrigger(hour=hour, minute=minute, timezone=ca_tz),
                id="daily_report",
                name="Daily Production Report",
                replace_existing=True,
                misfire_grace_time=self.misfire_grace_seconds,
                coalesce=self.coalesce,
                max_instances=self.max_instances,
            )
            if not quiet:
                self._log("OK", f"daily report configured at {self.report_time} PT")
                self._log("INFO", f"recipients: {self._recipients_summary()}")

        try:
            self.scheduler.start()
        except Exception:
            self._release_leader_lock()
            raise

        if not quiet:
            print("\n" + "=" * 70)
            self._log("OK", "scheduled task scheduler started")
            print("=" * 70 + "\n")
        return True

    def stop(self, quiet: bool = False):
        """Stop scheduler."""
        if self.scheduler.running:
            self.scheduler.shutdown()
            if not quiet:
                self._log("INFO", "scheduler stopped")
        self._release_leader_lock()

    def trigger_now(self):
        """Manually trigger report sending once (for testing)."""
        self._log("TEST", "manually triggering report sending")
        self.send_daily_report()

    def get_next_run_time(self):
        """Get next run time."""
        job = self.scheduler.get_job("daily_report")
        if job:
            return job.next_run_time
        return None

    def reload_schedule(self):
        """
        Dynamically reload schedule from database.
        Called when email settings are updated via API.
        """
        print("\n" + "=" * 70)
        self._log("INFO", "reloading scheduler configuration")
        print("=" * 70)

        self._load_config()

        if not self._is_leader and not self.scheduler.running:
            self._log("INFO", "scheduler is not active on this worker, config refreshed only")
            print("=" * 70 + "\n")
            return

        if self.scheduler.get_job("daily_report"):
            self.scheduler.remove_job("daily_report")
            self._log("INFO", "removed existing scheduled job")

        if not self.enabled:
            self._log("INFO", "email sending disabled, scheduler job not added")
        elif not self.recipients:
            self._log("WARN", "no recipients configured, scheduler job not added")
        else:
            try:
                hour, minute = map(int, self.report_time.split(":"))
                ca_tz = ZoneInfo("America/Los_Angeles")

                self.scheduler.add_job(
                    func=self.send_daily_report,
                    trigger=CronTrigger(hour=hour, minute=minute, timezone=ca_tz),
                    id="daily_report",
                    name="Daily Production Report",
                    replace_existing=True,
                    misfire_grace_time=self.misfire_grace_seconds,
                    coalesce=self.coalesce,
                    max_instances=self.max_instances,
                )

                self._log("OK", "schedule reloaded successfully")
                self._log("INFO", f"send time: {self.report_time} PT")
                self._log("INFO", f"enabled: {self.enabled}")
                self._log("INFO", f"recipients: {self._recipients_summary()}")

                try:
                    next_run = self.get_next_run_time()
                    if next_run:
                        self._log("INFO", f"next run: {next_run.strftime('%Y-%m-%d %H:%M:%S %Z')}")
                except Exception:
                    pass

            except ValueError as e:
                self._log("ERROR", f"invalid send time format: {self.report_time}, error: {e}")
            except Exception as e:
                self._log("ERROR", f"failed to reload schedule: {e}")

        print("=" * 70 + "\n")


# Global scheduler instance
_scheduler_instance = None


def get_scheduler(emit_init_log: bool = True) -> ReportScheduler:
    """Get global scheduler instance (singleton pattern)."""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = ReportScheduler(emit_init_log=emit_init_log)
    return _scheduler_instance


def start_scheduler(quiet: bool = False) -> bool:
    """Start scheduler (called in main.py)."""
    scheduler = get_scheduler(emit_init_log=not quiet)
    return scheduler.start(quiet=quiet)


def stop_scheduler(quiet: bool = False):
    """Stop scheduler."""
    global _scheduler_instance
    if _scheduler_instance:
        _scheduler_instance.stop(quiet=quiet)


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()

    scheduler = ReportScheduler()

    if len(sys.argv) > 1 and sys.argv[1] == "test":
        scheduler._log("TEST", "test mode: sending report immediately")
        scheduler.trigger_now()
    else:
        scheduler.start()

        try:
            print("Press Ctrl+C to stop scheduler...")
            import time
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n")
            scheduler._log("INFO", "stopping scheduler")
            scheduler.stop()
            scheduler._log("OK", "exited")
