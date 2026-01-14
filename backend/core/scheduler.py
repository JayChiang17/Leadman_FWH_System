"""
Scheduler - Automated Task Scheduler
Uses APScheduler to manage scheduled tasks including daily production reports and downtime summary
"""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import os
import sys

# Add parent directory to path for service imports
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from services.email_service import GraphAPIEmailService
from services.data_collection_service import DataCollectionService
from core.email_db import (
    init_email_tables,
    get_email_config,
    get_active_recipients,
    log_email_send
)


class ReportScheduler:
    """Report Scheduler - Manages all scheduled tasks"""

    def __init__(self):
        """Initialize scheduler"""
        self.scheduler = BackgroundScheduler()
        self.email_service = GraphAPIEmailService()
        self.data_service = DataCollectionService()

        # Initialize database tables
        try:
            init_email_tables()
        except Exception as e:
            print(f"[WARNING] Failed to initialize email tables: {e}")

        # Read configuration from database (fallback to environment variables)
        self._load_config()

        print("[INFO] Scheduler initialized")
        print(f"   Daily report send time: {self.report_time}")
        print(f"   Daily report enabled: {self.enabled}")
        print(f"   Daily report recipients: {', '.join(self.recipients) if self.recipients else 'Not configured'}")

    def _load_config(self):
        """Load configuration from database with fallback to environment variables"""
        try:
            # Try to get config from database
            config = get_email_config()
            if config:
                self.report_time = config['send_time']
                self.enabled = bool(config['enabled'])
            else:
                # Fallback to environment variables
                self.report_time = os.getenv("REPORT_SEND_TIME", "18:00")
                self.enabled = True

            # Get recipients from database
            recipient_list = get_active_recipients()
            if recipient_list:
                self.recipients = [r['email'] for r in recipient_list]
            else:
                # Fallback to environment variables
                self.recipients = os.getenv("DAILY_REPORT_EMAILS", "").split(",")
                self.recipients = [email.strip() for email in self.recipients if email.strip()]

        except Exception as e:
            print(f"[WARNING] Failed to load config from database: {e}")
            # Fallback to environment variables
            self.report_time = os.getenv("REPORT_SEND_TIME", "18:00")
            self.recipients = os.getenv("DAILY_REPORT_EMAILS", "").split(",")
            self.recipients = [email.strip() for email in self.recipients if email.strip()]
            self.enabled = True

    def _parse_recipients(self, recipients_str: str) -> list:
        """Parse recipient string"""
        if not recipients_str:
            return []
        return [email.strip() for email in recipients_str.split(',') if email.strip()]

    def send_daily_report(self):
        """
        Daily report task function
        This function will be called on schedule
        """
        print("\n" + "=" * 70)
        print(f"[INFO] Starting daily report generation and sending - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 70)

        try:
            # Reload config from database before sending
            self._load_config()

            # Check if email is enabled
            if not self.enabled:
                print("[INFO] Email sending is disabled in configuration")
                print("=" * 70 + "\n")
                return

            if not self.recipients:
                print("[WARNING] No recipients configured")
                print("=" * 70 + "\n")
                return

            # 1. Generate report data
            print("\nStep 1/2: Collecting data...")
            report_data = self.data_service.get_daily_report_data()

            # 2. Send email
            print("\nStep 2/2: Sending email...")
            success = self.email_service.send_daily_report(
                recipients=self.recipients,
                report_data=report_data
            )

            # 3. Log the send attempt
            try:
                log_email_send(
                    recipients=self.recipients,
                    status="success" if success else "failed",
                    error_message=None if success else "Email send failed",
                    triggered_by="scheduler:daily_report"
                )
            except Exception as log_error:
                print(f"[WARNING] Failed to log email send: {log_error}")

            if success:
                print("\n" + "=" * 70)
                print("[SUCCESS] Daily report sent successfully!")
                print("=" * 70 + "\n")
            else:
                print("\n" + "=" * 70)
                print("[ERROR] Daily report sending failed!")
                print("=" * 70 + "\n")

        except Exception as e:
            print(f"\n[ERROR] Error occurred while sending daily report: {e}")
            print("=" * 70 + "\n")

            # Log the error
            try:
                log_email_send(
                    recipients=self.recipients if hasattr(self, 'recipients') else [],
                    status="error",
                    error_message=str(e),
                    triggered_by="scheduler:daily_report"
                )
            except Exception as log_error:
                print(f"[WARNING] Failed to log email error: {log_error}")


    def start(self):
        """Start scheduler"""
        # Add daily report scheduled task (includes production data and downtime summary)
        if not self.enabled:
            print("[INFO] Email sending is disabled in configuration")
        elif not self.recipients:
            print("[WARNING] Daily report recipients not configured")
        else:
            # Parse send time
            try:
                hour, minute = map(int, self.report_time.split(":"))
            except:
                print(f"[WARNING] Invalid send time format: {self.report_time}")
                print("   Using default time 18:00")
                hour, minute = 18, 0

            # Add scheduled task: execute at specified time every day
            ca_tz = ZoneInfo("America/Los_Angeles")
            self.scheduler.add_job(
                func=self.send_daily_report,
                trigger=CronTrigger(hour=hour, minute=minute, timezone=ca_tz),
                id='daily_report',
                name='Daily Production Report',
                replace_existing=True
            )
            print(f"[SUCCESS] Daily report configured: Every day at {self.report_time}")
            print(f"   Recipients: {', '.join(self.recipients)}")

        # Start scheduler
        self.scheduler.start()

        print("\n" + "=" * 70)
        print("[SUCCESS] Scheduled task scheduler started")
        print("=" * 70 + "\n")

    def stop(self):
        """Stop scheduler"""
        if self.scheduler.running:
            self.scheduler.shutdown()
            print("[INFO] Scheduler stopped")

    def trigger_now(self):
        """
        Manually trigger report sending once (for testing)
        """
        print("[TEST] Manually triggering report sending...")
        self.send_daily_report()

    def get_next_run_time(self):
        """Get next run time"""
        job = self.scheduler.get_job('daily_report')
        if job:
            return job.next_run_time
        return None

    def reload_schedule(self):
        """
        Dynamically reload schedule from database
        This method is called when email settings are updated via API
        """
        print("\n" + "=" * 70)
        print("[INFO] Reloading scheduler configuration...")
        print("=" * 70)

        # 1. Reload configuration from database
        self._load_config()

        # 2. Remove existing job if it exists
        if self.scheduler.get_job('daily_report'):
            self.scheduler.remove_job('daily_report')
            print("[INFO] Removed existing scheduled job")

        # 3. Re-add job with new configuration
        if not self.enabled:
            print("[INFO] Email sending is disabled - scheduler job not added")
        elif not self.recipients:
            print("[WARNING] No recipients configured - scheduler job not added")
        else:
            try:
                # Parse send time
                hour, minute = map(int, self.report_time.split(":"))
                ca_tz = ZoneInfo("America/Los_Angeles")

                # Add new scheduled job
                self.scheduler.add_job(
                    func=self.send_daily_report,
                    trigger=CronTrigger(hour=hour, minute=minute, timezone=ca_tz),
                    id='daily_report',
                    name='Daily Production Report',
                    replace_existing=True
                )

                print(f"[SUCCESS] Schedule reloaded successfully")
                print(f"   Send time: {self.report_time} (Pacific Time)")
                print(f"   Enabled: {self.enabled}")
                print(f"   Recipients: {', '.join(self.recipients)}")

                try:
                    next_run = self.get_next_run_time()
                    if next_run:
                        print(f"   Next run: {next_run.strftime('%Y-%m-%d %H:%M:%S %Z')}")
                except Exception:
                    pass  # Ignore if next_run_time is not available yet

            except ValueError as e:
                print(f"[ERROR] Invalid send time format: {self.report_time}")
                print(f"   Error: {e}")
            except Exception as e:
                print(f"[ERROR] Failed to reload schedule: {e}")

        print("=" * 70 + "\n")


# Global scheduler instance
_scheduler_instance = None


def get_scheduler() -> ReportScheduler:
    """Get global scheduler instance (singleton pattern)"""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = ReportScheduler()
    return _scheduler_instance


def start_scheduler():
    """Start scheduler (called in main.py)"""
    scheduler = get_scheduler()
    scheduler.start()


def stop_scheduler():
    """Stop scheduler"""
    global _scheduler_instance
    if _scheduler_instance:
        _scheduler_instance.stop()


# Test code
if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv

    # Load environment variables
    load_dotenv()

    # Create scheduler
    scheduler = ReportScheduler()

    # Check arguments
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        # Test mode: send once immediately
        print("[TEST] Test mode: Sending report immediately")
        scheduler.trigger_now()
    else:
        # Normal mode: start scheduled tasks
        scheduler.start()

        try:
            print("Press Ctrl+C to stop scheduler...")
            # Keep program running
            import time
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n\n[INFO] Stopping scheduler...")
            scheduler.stop()
            print("[SUCCESS] Exited")
