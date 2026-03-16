"""
Email Service - Microsoft Graph API
使用 Microsoft Graph API 直接發送郵件
"""
import requests
import os
import logging
from typing import List
from datetime import datetime
import msal
from dotenv import load_dotenv
from core.time_utils import ca_now, ca_now_str

# Load environment variables
load_dotenv()
logger = logging.getLogger(__name__)


class GraphAPIEmailService:
    """使用 Microsoft Graph API 發送郵件"""

    def __init__(self):
        """初始化 Graph API 郵件服務"""
        # 從環境變量讀取 Azure AD 配置
        self.tenant_id = os.getenv("AZURE_TENANT_ID")
        self.client_id = os.getenv("AZURE_CLIENT_ID")
        self.client_secret = os.getenv("AZURE_CLIENT_SECRET")
        self.sender_email = os.getenv("SENDER_EMAIL", "jay.chiang@leadman.com")
        self.default_from_name = os.getenv("EMAIL_FROM_NAME", "Leadman Production Report")

        # 驗證必需配置
        if not all([self.tenant_id, self.client_id, self.client_secret]):
            raise ValueError(
                "未配置 Azure AD 憑證，請檢查 .env 文件：\n"
                "   需要：AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET"
            )

        # Graph API 端點
        self.authority = f"https://login.microsoftonline.com/{self.tenant_id}"
        self.scope = ["https://graph.microsoft.com/.default"]
        self.graph_endpoint = "https://graph.microsoft.com/v1.0"

        # 創建 MSAL 應用
        self.app = msal.ConfidentialClientApplication(
            self.client_id,
            authority=self.authority,
            client_credential=self.client_secret,
        )

        logger.info("Graph API Email Service initialized")

    def _get_access_token(self) -> str:
        """
        獲取 Microsoft Graph API 訪問令牌（使用 Client Credentials Flow）

        Returns:
            str: Access token
        """
        try:
            # 使用客戶端憑證流程獲取 token
            result = self.app.acquire_token_silent(self.scope, account=None)

            if not result:
                result = self.app.acquire_token_for_client(scopes=self.scope)

            if "access_token" in result:
                return result["access_token"]
            else:
                error_description = result.get("error_description", "Unknown error")
                raise Exception(f"Failed to get access token: {error_description}")

        except Exception as e:
            raise Exception(f"Failed to get Graph API token: {e}")

    def send_email(
        self,
        recipients: List[str],
        subject: str,
        html_content: str,
        from_name: str = None
    ) -> bool:
        """
        使用 Microsoft Graph API 發送郵件

        Args:
            recipients: 收件人列表
            subject: 郵件主題
            html_content: HTML 格式的郵件內容
            from_name: 發件人顯示名稱（可選）

        Returns:
            bool: 發送是否成功
        """
        try:
            # 獲取訪問令牌
            token = self._get_access_token()

            # 構建收件人列表
            to_recipients = [
                {"emailAddress": {"address": email.strip()}}
                for email in recipients
                if email.strip()
            ]

            if not to_recipients:
                logger.warning("No valid recipients")
                return False

            # Build email content
            email_msg = {
                "message": {
                    "subject": subject,
                    "body": {
                        "contentType": "HTML",
                        "content": html_content
                    },
                    "toRecipients": to_recipients
                },
                "saveToSentItems": "true"
            }

            logger.info("Sending email: subject=%s recipients=%d", subject, len(recipients))

            # 調用 Graph API 發送郵件
            # 端點：POST /users/{user-id}/sendMail
            send_mail_url = f"{self.graph_endpoint}/users/{self.sender_email}/sendMail"

            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }

            response = requests.post(
                send_mail_url,
                headers=headers,
                json=email_msg,
                timeout=30
            )

            # Graph API sendMail returns 202 Accepted on success
            if response.status_code == 202:
                logger.info("Email sent successfully")
                return True
            else:
                logger.error(
                    "Email send failed: status=%s response=%s",
                    response.status_code,
                    response.text,
                )
                return False

        except requests.exceptions.Timeout:
            logger.error("Email send timeout (30 seconds)")
            return False

        except requests.exceptions.RequestException as e:
            logger.error("Network error while sending email: %s", e)
            return False

        except Exception as e:
            logger.error("Error sending email: %s", e)
            return False

    def send_daily_report(
        self,
        recipients: List[str],
        report_data: dict
    ) -> bool:
        """
        發送每日生產報告

        Args:
            recipients: 收件人列表
            report_data: 報告數據字典，包含各種統計信息

        Returns:
            bool: 發送是否成功
        """
        # Generate email subject
        today = ca_now().strftime("%Y-%m-%d")
        subject = f"FranklinWH Daily Production Report - {today}"

        # 生成 HTML 內容
        html_content = self._generate_report_html(report_data)

        # 發送郵件
        return self.send_email(
            recipients=recipients,
            subject=subject,
            html_content=html_content
        )

    def send_risk_alert(
        self,
        recipients: List[str],
        risk_data: dict
    ) -> bool:
        """
        發送風險警報

        Args:
            recipients: 收件人列表
            risk_data: 風險數據字典

        Returns:
            bool: 發送是否成功
        """
        # 生成郵件主題
        risk_level = risk_data.get('risk_level', 'CRITICAL')
        line_name = risk_data.get('line_name', '')
        subject = f"Warning 生產風險警報 - {risk_level} - {line_name}"

        # 生成 HTML 內容
        html_content = self._generate_risk_alert_html(risk_data)

        # 發送郵件
        return self.send_email(
            recipients=recipients,
            subject=subject,
            html_content=html_content
        )

    def send_downtime_alert(
        self,
        recipients: List[str],
        downtime_data: dict
    ) -> bool:
        """
        發送停機警報

        Args:
            recipients: 收件人列表
            downtime_data: 停機數據字典

        Returns:
            bool: 發送是否成功
        """
        # 生成郵件主題
        line = downtime_data.get('line', '')
        station = downtime_data.get('station', '')
        duration = downtime_data.get('duration_minutes', 0)
        subject = f"🔴 停機超時警報 - {line} {station} ({duration}分鐘)"

        # 生成 HTML 內容
        html_content = self._generate_downtime_alert_html(downtime_data)

        # 發送郵件
        return self.send_email(
            recipients=recipients,
            subject=subject,
            html_content=html_content
        )

    def _generate_report_html(self, data: dict) -> str:
        """
        Generate report HTML content

        Args:
            data: Report data

        Returns:
            str: HTML formatted email content
        """
        # Extract data
        today = ca_now().strftime("%Y-%m-%d")
        module_count = data.get('module_production', 0)
        module_plan = data.get('module_plan', 0)
        assembly_count = data.get('assembly_production', 0)
        assembly_plan = data.get('assembly_plan', 0)
        total_ng = data.get('total_ng', 0)
        ng_reasons = data.get('ng_reasons', [])
        downtime_hours          = data.get('downtime_hours', 0)
        cell_downtime_hours     = data.get('cell_downtime_hours', 0)
        assembly_downtime_hours = data.get('assembly_downtime_hours', 0)
        downtime_details        = data.get('downtime_details', [])
        cell_downtime_top5      = data.get('cell_downtime_top5', [])
        assembly_downtime_top5  = data.get('assembly_downtime_top5', [])
        module_efficiency = data.get('module_efficiency', 0)
        assembly_efficiency = data.get('assembly_efficiency', 0)
        module_a_hourly = data.get('module_a_hourly', [])
        module_b_hourly = data.get('module_b_hourly', [])
        assembly_hourly = data.get('assembly_hourly', [])
        module_total_hourly = data.get('module_total_hourly', [])
        assembly_total_hourly = data.get('assembly_total_hourly', [])
        downtime_cell_hourly = data.get('downtime_cell_hourly', [])
        downtime_assembly_hourly = data.get('downtime_assembly_hourly', [])

        # Weekly cumulative data
        weekly_module_count = data.get('weekly_module_count', 0)
        weekly_module_plan = data.get('weekly_module_plan', 0)
        weekly_module_efficiency = data.get('weekly_module_efficiency', 0)
        weekly_assembly_count = data.get('weekly_assembly_count', 0)
        weekly_assembly_plan = data.get('weekly_assembly_plan', 0)
        weekly_assembly_efficiency = data.get('weekly_assembly_efficiency', 0)
        weekly_total_ng = data.get('weekly_total_ng', 0)
        week_start = data.get('week_start', '')
        day_range = data.get('day_range', 'N/A')

        # Generate hourly production chart with A/B lines (side-by-side bars) - COMPACT PREMIUM DESIGN
        def generate_dual_line_chart(data_a, data_b, color_a, color_b, label, label_a="Module A", label_b="Module B"):
            if not data_a and not data_b:
                return '<div style="text-align: center; color: #9ca3af; padding: 20px;">No hourly data</div>'

            # Render full 24 hours to avoid empty space on the right
            all_hours = list(range(24))

            # Create dictionaries for quick lookup
            dict_a = {int(h['hour']): h['count'] for h in data_a}
            dict_b = {int(h['hour']): h['count'] for h in data_b}

            # Find max value for scaling
            all_counts = [dict_a.get(h, 0) for h in all_hours] + [dict_b.get(h, 0) for h in all_hours]
            max_val = max(all_counts) if all_counts else 1
            max_val = max(max_val, 10)

            bar_area_height = 140
            bar_width = 18
            bar_gap = 2

            # Generate dual bars - Outlook-safe table layout
            bars_html = ""
            col_width = bar_width * 2 + bar_gap
            for hour in all_hours:
                count_a = dict_a.get(hour, 0)
                count_b = dict_b.get(hour, 0)

                height_a = int((count_a / max_val) * bar_area_height) if count_a > 0 else 0
                height_b = int((count_b / max_val) * bar_area_height) if count_b > 0 else 0
                if count_a > 0:
                    height_a = max(height_a, 2)
                if count_b > 0:
                    height_b = max(height_b, 2)

                h_label = f"{hour}h" if hour % 4 == 0 else ""

                bar_a_html = (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="{height_a}" role="presentation" bgcolor="{color_a}" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="{height_a}" bgcolor="{color_a}" style="height:{height_a}px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                ) if count_a > 0 else (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="2" role="presentation" bgcolor="#e5e7eb" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="2" bgcolor="#e5e7eb" style="height:2px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                )

                bar_b_html = (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="{height_b}" role="presentation" bgcolor="{color_b}" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="{height_b}" bgcolor="{color_b}" style="height:{height_b}px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                ) if count_b > 0 else (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="2" role="presentation" bgcolor="#e5e7eb" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="2" bgcolor="#e5e7eb" style="height:2px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                )

                bars_html += f"""
                <td width="{col_width}" style="padding: 0; vertical-align: bottom; border: none; text-align: center;">
                    <table cellspacing="0" cellpadding="0" border="0" width="{col_width}" role="presentation" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">
                        <tr>
                            <td colspan="3" style="text-align: center; padding: 0 0 3px 0; font-size: 10px; font-weight: 700; color: #374151; border: none; line-height: 1; white-space: nowrap;">
                                {h_label}
                            </td>
                        </tr>
                        <tr>
                            <td width="{bar_width}" height="{bar_area_height}" valign="bottom" style="height:{bar_area_height}px; padding: 0; vertical-align: bottom; border: none;">
                                {bar_a_html}
                            </td>
                            <td width="{bar_gap}" style="font-size:0; line-height:0;">&nbsp;</td>
                            <td width="{bar_width}" height="{bar_area_height}" valign="bottom" style="height:{bar_area_height}px; padding: 0; vertical-align: bottom; border: none;">
                                {bar_b_html}
                            </td>
                        </tr>
                        <tr>
                            <td style="text-align: center; padding: 3px 0 0 0; font-size: 9px; font-weight: 600; color: #374151; border: none; line-height: 1;">{count_a if count_a > 0 else '-'}</td>
                            <td width="{bar_gap}"></td>
                            <td style="text-align: center; padding: 3px 0 0 0; font-size: 9px; font-weight: 600; color: #374151; border: none; line-height: 1;">{count_b if count_b > 0 else '-'}</td>
                        </tr>
                    </table>
                </td>
                """

            chart = f"""
            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 16px;">
                <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-collapse: collapse; margin-bottom: 10px; mso-table-lspace:0pt; mso-table-rspace:0pt;">
                    <tr>
                        <td style="text-align: left; font-size: 14px; font-weight: 700; color: #000000; letter-spacing: -0.02em;">{label}</td>
                        <td style="text-align: right;">
                            <span style="display: inline-block; width: 12px; height: 12px; background-color: {color_a}; vertical-align: middle;"></span>
                            <span style="font-size: 11px; font-weight: 700; color: {color_a}; margin: 0 10px 0 4px;">{label_a}</span>
                            <span style="display: inline-block; width: 12px; height: 12px; background-color: {color_b}; vertical-align: middle;"></span>
                            <span style="font-size: 11px; font-weight: 700; color: {color_b}; margin-left: 4px;">{label_b}</span>
                        </td>
                    </tr>
                </table>
                <div style="background: white; padding: 12px 6px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-collapse: collapse; border-bottom: 2px solid #cbd5e1; table-layout: fixed; mso-table-lspace:0pt; mso-table-rspace:0pt;">
                        <tr>
                            {bars_html}
                        </tr>
                    </table>
                </div>
                <div style="font-size: 11px; font-weight: 600; color: #000000; margin-top: 8px;">Unit: pcs/hour</div>
            </div>
            """
            return chart

        # Generate single-line chart for assembly - COMPACT PREMIUM DESIGN
        def generate_single_chart(hourly_data, color, label):
            if not hourly_data:
                return '<div style="text-align: center; color: #9ca3af; padding: 20px;">No hourly data</div>'

            max_val = max([h['count'] for h in hourly_data]) if hourly_data else 1
            max_val = max(max_val, 10)

            bar_area_height = 140
            bar_width = 22

            bars_html = ""
            hourly_map = {int(h["hour"]): h["count"] for h in hourly_data}
            for hour in range(24):
                count = hourly_map.get(hour, 0)
                height = int((count / max_val) * bar_area_height) if count > 0 else 0
                if count > 0:
                    height = max(height, 2)

                h_label = f"{hour}h" if hour % 4 == 0 else ""

                bar_html = (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="{height}" role="presentation" bgcolor="{color}" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="{height}" bgcolor="{color}" style="height:{height}px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                ) if count > 0 else (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="2" role="presentation" bgcolor="#e5e7eb" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="2" bgcolor="#e5e7eb" style="height:2px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                )

                bars_html += f"""
                <td width="{bar_width}" style="padding: 0; vertical-align: bottom; border: none; text-align: center;">
                    <table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" align="center" role="presentation" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">
                        <tr>
                            <td style="text-align: center; padding: 0 0 3px 0; font-size: 10px; font-weight: 700; color: #374151; border: none; line-height: 1; white-space: nowrap;">
                                {h_label}
                            </td>
                        </tr>
                        <tr>
                            <td width="{bar_width}" height="{bar_area_height}" valign="bottom" style="height:{bar_area_height}px; padding: 0; vertical-align: bottom; border: none;">
                                {bar_html}
                            </td>
                        </tr>
                        <tr>
                            <td style="text-align: center; padding: 3px 0 0 0; font-size: 9px; font-weight: 600; color: #374151; border: none; line-height: 1;">{count if count > 0 else '-'}</td>
                        </tr>
                    </table>
                </td>
                """

            chart = f"""
            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 16px;">
                <div style="font-size: 14px; font-weight: 700; color: #000000; margin-bottom: 10px; letter-spacing: -0.02em;">{label}</div>
                <div style="background: white; padding: 12px 6px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-collapse: collapse; border-bottom: 2px solid {color}; table-layout: fixed; mso-table-lspace:0pt; mso-table-rspace:0pt;">
                        <tr>
                            {bars_html}
                        </tr>
                    </table>
                </div>
                <div style="font-size: 11px; font-weight: 600; color: #000000; margin-top: 8px;">Unit: pcs/hour</div>
            </div>
            """
            return chart

        def merge_hourly_totals(data_a, data_b):
            totals = {}
            for row in data_a or []:
                try:
                    hour = int(row.get('hour'))
                except (TypeError, ValueError):
                    continue
                totals[hour] = totals.get(hour, 0) + int(row.get('count', 0) or 0)
            for row in data_b or []:
                try:
                    hour = int(row.get('hour'))
                except (TypeError, ValueError):
                    continue
                totals[hour] = totals.get(hour, 0) + int(row.get('count', 0) or 0)
            return [{'hour': h, 'count': totals[h]} for h in sorted(totals.keys())]

        def generate_uph_downtime_chart(uph_hourly, downtime_hourly, color_uph, color_dt, label):
            if not uph_hourly and not downtime_hourly:
                return '<div style="text-align: center; color: #9ca3af; padding: 20px;">No hourly data</div>'

            uph_map = {}
            for row in uph_hourly or []:
                try:
                    hour = int(row.get('hour'))
                except (TypeError, ValueError):
                    continue
                uph_map[hour] = int(row.get('count', 0) or 0)

            dt_map = {}
            for row in downtime_hourly or []:
                try:
                    hour = int(row.get('hour'))
                except (TypeError, ValueError):
                    continue
                dt_map[hour] = int(round(float(row.get('minutes', 0) or 0)))

            max_uph = max(uph_map.values(), default=0)
            max_dt = max(dt_map.values(), default=0)
            max_uph = max(max_uph, 1)
            max_dt = max(max_dt, 1)

            bar_area_height = 140
            bar_width = 18
            bar_gap = 2
            col_width = bar_width * 2 + bar_gap

            bars_html = ""
            for hour in range(24):
                uph = uph_map.get(hour, 0)
                dt = dt_map.get(hour, 0)

                uph_height = int((uph / max_uph) * bar_area_height) if uph > 0 else 0
                dt_height = int((dt / max_dt) * bar_area_height) if dt > 0 else 0
                if uph > 0:
                    uph_height = max(uph_height, 2)
                if dt > 0:
                    dt_height = max(dt_height, 2)

                h_label = f"{hour}h" if hour % 4 == 0 else ""

                uph_bar_html = (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="{uph_height}" role="presentation" bgcolor="{color_uph}" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="{uph_height}" bgcolor="{color_uph}" style="height:{uph_height}px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                ) if uph > 0 else (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="2" role="presentation" bgcolor="#e5e7eb" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="2" bgcolor="#e5e7eb" style="height:2px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                )

                dt_bar_html = (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="{dt_height}" role="presentation" bgcolor="{color_dt}" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="{dt_height}" bgcolor="{color_dt}" style="height:{dt_height}px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                ) if dt > 0 else (
                    f'<table cellspacing="0" cellpadding="0" border="0" width="{bar_width}" height="2" role="presentation" bgcolor="#e5e7eb" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">'
                    f'<tr><td height="2" bgcolor="#e5e7eb" style="height:2px; font-size:0; line-height:0; mso-line-height-rule:exactly;">&nbsp;</td></tr></table>'
                )

                bars_html += f"""
                <td width="{col_width}" style="padding: 0; vertical-align: bottom; border: none; text-align: center;">
                    <table cellspacing="0" cellpadding="0" border="0" width="{col_width}" role="presentation" style="border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">
                        <tr>
                            <td colspan="3" style="text-align: center; padding: 0 0 3px 0; font-size: 10px; font-weight: 700; color: #374151; border: none; line-height: 1; white-space: nowrap;">
                                {h_label}
                            </td>
                        </tr>
                        <tr>
                            <td width="{bar_width}" height="{bar_area_height}" valign="bottom" style="height:{bar_area_height}px; padding: 0; vertical-align: bottom; border: none;">
                                {uph_bar_html}
                            </td>
                            <td width="{bar_gap}" style="font-size:0; line-height:0;">&nbsp;</td>
                            <td width="{bar_width}" height="{bar_area_height}" valign="bottom" style="height:{bar_area_height}px; padding: 0; vertical-align: bottom; border: none;">
                                {dt_bar_html}
                            </td>
                        </tr>
                        <tr>
                            <td style="text-align: center; padding: 3px 0 0 0; font-size: 9px; font-weight: 600; color: #374151; border: none; line-height: 1;">{uph if uph > 0 else '-'}</td>
                            <td width="{bar_gap}"></td>
                            <td style="text-align: center; padding: 3px 0 0 0; font-size: 9px; font-weight: 600; color: #374151; border: none; line-height: 1;">{dt if dt > 0 else '-'}</td>
                        </tr>
                    </table>
                </td>
                """

            chart = f"""
            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 16px;">
                <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-collapse: collapse; margin-bottom: 10px; mso-table-lspace:0pt; mso-table-rspace:0pt;">
                    <tr>
                        <td style="text-align: left; font-size: 14px; font-weight: 700; color: #000000; letter-spacing: -0.02em;">{label}</td>
                        <td style="text-align: right;">
                            <span style="display: inline-block; width: 12px; height: 12px; background-color: {color_uph}; vertical-align: middle;"></span>
                            <span style="font-size: 11px; font-weight: 700; color: {color_uph}; margin: 0 10px 0 4px;">UPH</span>
                            <span style="display: inline-block; width: 12px; height: 12px; background-color: {color_dt}; vertical-align: middle;"></span>
                            <span style="font-size: 11px; font-weight: 700; color: {color_dt}; margin-left: 4px;">Downtime (min)</span>
                        </td>
                    </tr>
                </table>
                <div style="background: white; padding: 12px 6px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-collapse: collapse; border-bottom: 2px solid #cbd5e1; table-layout: fixed; mso-table-lspace:0pt; mso-table-rspace:0pt;">
                        <tr>
                            {bars_html}
                        </tr>
                    </table>
                </div>
                <div style="font-size: 11px; font-weight: 600; color: #000000; margin-top: 8px;">Unit: UPH = pcs/hour, Downtime = minutes</div>
            </div>
            """
            return chart

        module_chart = generate_dual_line_chart(
            module_a_hourly, module_b_hourly,
            '#0d9488', '#f59e0b',           # teal (Module A) vs amber (Module B) — clearly distinct
            'Module Hourly Production',
            label_a='Module A', label_b='Module B',
        )
        assembly_chart = generate_single_chart(assembly_hourly, '#0891b2', 'Assembly Hourly Production')

        if not module_total_hourly:
            module_total_hourly = merge_hourly_totals(module_a_hourly, module_b_hourly)
        if not assembly_total_hourly:
            assembly_total_hourly = assembly_hourly

        uph_vs_dt_cell_chart = generate_uph_downtime_chart(
            module_total_hourly,
            downtime_cell_hourly,
            '#0d9488',   # teal — matches Module card brand color
            '#ef4444',   # red — downtime
            'UPH vs Downtime — Cell Line (Module A+B Combined)'
        )
        uph_vs_dt_assembly_chart = generate_uph_downtime_chart(
            assembly_total_hourly,
            downtime_assembly_hourly,
            '#059669',   # emerald — matches Assembly card color
            '#ef4444',   # red — downtime
            'UPH vs Downtime — Assembly Line'
        )

        # Generate NG reasons HTML - COMPACT PROFESSIONAL STYLE
        ng_reasons_html = ""
        for idx, reason in enumerate(ng_reasons[:5], 1):
            ng_reasons_html += f"""
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 6px 8px; color: #64748b; font-weight: 600;">{idx}</td>
                <td style="padding: 6px 8px; color: #334155;">{reason['reason']}</td>
                <td style="padding: 6px 8px; text-align: right; color: #0f172a; font-weight: 700;">{reason['count']}</td>
                <td style="padding: 6px 8px; text-align: right; color: #dc2626; font-weight: 700;">{reason['percentage']:.1f}%</td>
            </tr>
            """
        no_ng_message = "No NG records today" if total_ng == 0 else "NG records found but no reasons recorded"
        ng_empty_html = (
            "<tr><td colspan=\"4\" style=\"padding: 12px; text-align: center; color: #94a3b8; "
            f"font-style: italic;\">{no_ng_message}</td></tr>"
        )

        # Generate per-line downtime rows (# | Station | Duration, no Line column)
        def _dt_rows(events, empty_msg):
            if not events:
                return (
                    f'<tr><td colspan="3" style="padding: 12px; text-align: center; '
                    f'color: #94a3b8; font-style: italic;">{empty_msg}</td></tr>'
                )
            rows_html = ""
            for idx, dt in enumerate(events, 1):
                dm = dt['duration_minutes']
                dh = dm / 60
                disp = f"{int(dh)}h {int(dm % 60)}m" if dh >= 1 else f"{int(dm)}m"
                rows_html += (
                    f'<tr style="border-bottom: 1px solid #e2e8f0;">'
                    f'<td style="padding: 6px 8px; color: #64748b; font-weight: 600;">{idx}</td>'
                    f'<td style="padding: 6px 8px; color: #334155;">{dt["station"]}</td>'
                    f'<td style="padding: 6px 8px; text-align: right; color: #dc2626; font-weight: 700;">{disp}</td>'
                    f'</tr>'
                )
            return rows_html

        cell_dt_rows     = _dt_rows(cell_downtime_top5,     "No Cell line downtime today")
        assembly_dt_rows = _dt_rows(assembly_downtime_top5, "No Assembly downtime today")

        # ── Plan B: Outlook-safe efficiency progress bar ──────────────────────
        def _eff_color(pct):
            if pct >= 100: return '#059669'
            if pct >= 80:  return '#0d9488'
            if pct >= 60:  return '#f59e0b'
            return '#dc2626'

        def _eff_bar(pct, color):
            p = min(max(int(pct or 0), 0), 100)
            r = 100 - p
            right = (
                f'<td width="{r}%" height="5" bgcolor="#e2e8f0" '
                f'style="height:5px;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td>'
            ) if r > 0 else ''
            return (
                f'<table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" '
                f'style="border-collapse:collapse;margin-top:8px;mso-table-lspace:0pt;mso-table-rspace:0pt;">'
                f'<tr>'
                f'<td width="{p}%" height="5" bgcolor="{color}" '
                f'style="height:5px;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td>'
                f'{right}'
                f'</tr></table>'
            )

        mod_eff_color = _eff_color(module_efficiency)
        asm_eff_color = _eff_color(assembly_efficiency)
        mod_bar       = _eff_bar(module_efficiency,   mod_eff_color)
        asm_bar       = _eff_bar(assembly_efficiency, asm_eff_color)

        # ── Plan C: Production status banner ─────────────────────────────────
        min_eff = min(
            module_efficiency   if module_plan   > 0 else 100,
            assembly_efficiency if assembly_plan > 0 else 100,
        )
        if min_eff >= 90 and total_ng == 0:
            sb_bg, sb_bd  = '#f0fdf4', '#86efac'
            sb_tc, sb_dot = '#15803d', '#059669'
            sb_label      = 'ALL LINES ON TRACK'
        elif min_eff < 60 or total_ng > 5:
            sb_bg, sb_bd  = '#fef2f2', '#fca5a5'
            sb_tc, sb_dot = '#b91c1c', '#dc2626'
            sb_label      = 'ACTION REQUIRED'
        else:
            sb_bg, sb_bd  = '#fffbeb', '#fcd34d'
            sb_tc, sb_dot = '#92400e', '#d97706'
            sb_label      = 'ATTENTION NEEDED'

        # ── Plan D: One-line summary sentence ────────────────────────────────
        _parts = []
        if assembly_plan > 0:
            _parts.append(f'{assembly_count}/{assembly_plan} assembled ({assembly_efficiency}% eff.)')
        if module_plan > 0:
            _parts.append(f'{module_count}/{module_plan} module ({module_efficiency}% eff.)')
        _parts.append(f'{total_ng} NG unit{"s" if total_ng != 1 else ""} today')
        if downtime_hours > 0:
            _parts.append(f'{downtime_hours}h downtime (Cell {cell_downtime_hours}h / Asm {assembly_downtime_hours}h)')
        summary_sentence = ' — '.join(_parts) + '.'

        # HTML template - PREMIUM COMPACT PROFESSIONAL DESIGN
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f1f5f9; color: #0f172a;">

            <!-- Main Container -->
            <table cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f1f5f9;">
                <tr>
                    <td align="center" style="padding: 20px 10px;">

                        <!-- Email Content (max-width 1100px) -->
                        <table cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 1200px; background-color: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

                            <!-- Header — Plan A: dark charcoal + teal accent -->
                            <tr>
                                <td style="background-color: #0f172a; padding: 22px 30px 18px 30px; border-radius: 8px 8px 0 0; border-bottom: 3px solid #0d9488;">
                                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-collapse:collapse;">
                                        <tr>
                                            <td>
                                                <div style="font-size: 10px; font-weight: 700; color: #0d9488; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 5px;">Daily Production Report</div>
                                                <div style="font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; line-height: 1;">FranklinWH</div>
                                                <div style="font-size: 11px; color: #64748b; margin-top: 4px; font-weight: 500;">Leadman Manufacturing System</div>
                                            </td>
                                            <td align="right" valign="middle">
                                                <div style="background: rgba(13,148,136,0.15); border: 1px solid rgba(13,148,136,0.4); padding: 10px 16px; border-radius: 6px; display: inline-block; text-align: center;">
                                                    <div style="font-size: 10px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px;">Report Date</div>
                                                    <div style="font-size: 16px; color: #ffffff; font-weight: 700; letter-spacing: 0.5px;">{today}</div>
                                                </div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <!-- Plan C: Status Banner -->
                            <tr>
                                <td style="padding: 14px 30px 0 30px;">
                                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation"
                                           style="border-collapse:collapse; background:{sb_bg}; border:1.5px solid {sb_bd}; border-radius:6px;">
                                        <tr>
                                            <td style="padding: 10px 16px;">
                                                <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-collapse:collapse;">
                                                    <tr>
                                                        <td>
                                                            <table cellspacing="0" cellpadding="0" border="0" role="presentation" style="border-collapse:collapse; display:inline-table;">
                                                                <tr>
                                                                    <td width="9" height="9" bgcolor="{sb_dot}" style="height:9px;width:9px;font-size:0;line-height:0;border-radius:50%;mso-line-height-rule:exactly;">&nbsp;</td>
                                                                    <td style="padding-left:8px; font-size:12px; font-weight:800; color:{sb_tc}; text-transform:uppercase; letter-spacing:1.5px; white-space:nowrap;">{sb_label}</td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                        <td align="right" style="font-size:11px; color:{sb_tc}; font-weight:500; padding-left:16px;">{summary_sentence}</td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <!-- Production KPI Cards -->
                            <tr>
                                <td style="padding: 24px 30px 16px 30px;">
                                    <table cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <!-- Module Production Card — Plan A (teal) + Plan B (progress bar) -->
                                            <td width="32%" style="background: #f0fdfa; border: 2px solid #0d9488; border-radius: 6px; padding: 18px; vertical-align: top;">
                                                <div style="font-size: 10px; font-weight: 700; color: #0d9488; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Module Production</div>
                                                <div style="font-size: 38px; font-weight: 800; color: #0f172a; line-height: 1; margin-bottom: 4px;">
                                                    {module_count}<span style="font-size: 18px; font-weight: 600; color: #64748b;"> / {module_plan}</span>
                                                </div>
                                                <div style="font-size: 13px; font-weight: 700; color: {mod_eff_color};">
                                                    {module_efficiency}% Efficiency
                                                </div>
                                                {mod_bar}
                                            </td>
                                            <td width="2%"></td>
                                            <!-- Assembly Production Card — Plan B (progress bar) -->
                                            <td width="32%" style="background: #f0fdf4; border: 2px solid #10b981; border-radius: 6px; padding: 18px; vertical-align: top;">
                                                <div style="font-size: 10px; font-weight: 700; color: #059669; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Assembly Production</div>
                                                <div style="font-size: 38px; font-weight: 800; color: #0f172a; line-height: 1; margin-bottom: 4px;">
                                                    {assembly_count}<span style="font-size: 18px; font-weight: 600; color: #64748b;"> / {assembly_plan}</span>
                                                </div>
                                                <div style="font-size: 13px; font-weight: 700; color: {asm_eff_color};">
                                                    {assembly_efficiency}% Efficiency
                                                </div>
                                                {asm_bar}
                                            </td>
                                            <td width="2%"></td>
                                            <!-- NG Card — Plan D: downtime totals below NG count -->
                                            <td width="32%" style="background: #fef2f2; border: 2px solid #ef4444; border-radius: 6px; padding: 18px; vertical-align: top;">
                                                <div style="font-size: 10px; font-weight: 700; color: #dc2626; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Total NG Today</div>
                                                <div style="font-size: 44px; font-weight: 800; color: #991b1b; line-height: 1; margin-bottom: 8px;">
                                                    {total_ng}
                                                </div>
                                                <div style="border-top: 1px solid #fecaca; padding-top: 8px; margin-top: 2px;">
                                                    <div style="font-size: 10px; font-weight: 700; color: #dc2626; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Downtime Today</div>
                                                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-collapse:collapse;">
                                                        <tr>
                                                            <td style="font-size: 11px; font-weight: 600; color: #991b1b;">Cell</td>
                                                            <td align="right" style="font-size: 13px; font-weight: 800; color: #991b1b;">{cell_downtime_hours}h</td>
                                                        </tr>
                                                        <tr>
                                                            <td style="font-size: 11px; font-weight: 600; color: #1d4ed8; padding-top: 3px;">Assembly</td>
                                                            <td align="right" style="font-size: 13px; font-weight: 800; color: #1d4ed8; padding-top: 3px;">{assembly_downtime_hours}h</td>
                                                        </tr>
                                                        <tr>
                                                            <td style="font-size: 10px; color: #64748b; padding-top: 4px; border-top: 1px solid #fecaca;">Total</td>
                                                            <td align="right" style="font-size: 12px; font-weight: 700; color: #475569; padding-top: 4px; border-top: 1px solid #fecaca;">{downtime_hours}h</td>
                                                        </tr>
                                                    </table>
                                                </div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <!-- Weekly Cumulative Summary Section -->
                            <tr>
                                <td style="padding: 8px 30px 16px 30px;">
                                    <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 8px; padding: 16px 20px;">
                                        <table cellspacing="0" cellpadding="0" border="0" width="100%">
                                            <tr>
                                                <td colspan="3" style="padding-bottom: 12px; border-bottom: 1px solid #fbbf24;">
                                                    <div style="font-size: 13px; font-weight: 800; color: #92400e; text-transform: uppercase; letter-spacing: 1px;">
                                                        Weekly Cumulative ({day_range})
                                                    </div>
                                                    <div style="font-size: 10px; color: #b45309; margin-top: 2px;">Week starting {week_start}</div>
                                                </td>
                                            </tr>
                                            <tr>
                                                <!-- Weekly Module -->
                                                <td width="32%" style="padding-top: 12px; vertical-align: top;">
                                                    <div style="font-size: 10px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">Module (Week)</div>
                                                    <div style="font-size: 28px; font-weight: 800; color: #78350f; line-height: 1;">
                                                        {weekly_module_count}<span style="font-size: 14px; font-weight: 600; color: #92400e;"> / {weekly_module_plan}</span>
                                                    </div>
                                                    <div style="font-size: 11px; font-weight: 600; color: {'#059669' if weekly_module_efficiency >= 90 else '#f59e0b' if weekly_module_efficiency >= 70 else '#dc2626'}; margin-top: 2px;">
                                                        {weekly_module_efficiency}% Eff.
                                                    </div>
                                                </td>
                                                <!-- Weekly Assembly -->
                                                <td width="32%" style="padding-top: 12px; vertical-align: top;">
                                                    <div style="font-size: 10px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">Assembly (Week)</div>
                                                    <div style="font-size: 28px; font-weight: 800; color: #78350f; line-height: 1;">
                                                        {weekly_assembly_count}<span style="font-size: 14px; font-weight: 600; color: #92400e;"> / {weekly_assembly_plan}</span>
                                                    </div>
                                                    <div style="font-size: 11px; font-weight: 600; color: {'#059669' if weekly_assembly_efficiency >= 90 else '#f59e0b' if weekly_assembly_efficiency >= 70 else '#dc2626'}; margin-top: 2px;">
                                                        {weekly_assembly_efficiency}% Eff.
                                                    </div>
                                                </td>
                                                <!-- Weekly NG -->
                                                <td width="32%" style="padding-top: 12px; text-align: center; vertical-align: top;">
                                                    <div style="font-size: 10px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;">Total NG (Week)</div>
                                                    <div style="font-size: 32px; font-weight: 800; color: #dc2626; line-height: 1;">
                                                        {weekly_total_ng}
                                                    </div>
                                                </td>
                                            </tr>
                                        </table>
                                    </div>
                                </td>
                            </tr>

                            <!-- Compatibility Note -->
                            <tr>
                                <td style="padding: 0 30px 10px 30px;">
                                    <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; padding: 10px 12px; font-size: 12px; color: #000000; line-height: 1.4;">
                                        Note: Due to legacy Outlook limitations, charts may look unusual. Mobile or newer Outlook versions display normally.
                                    </div>
                                </td>
                            </tr>

                            <!-- Charts Section -->
                            <tr>
                                <td style="padding: 14px 30px;">
                                    {module_chart}
                                    {assembly_chart}
                                </td>
                            </tr>

                            <!-- 3-Column: NG Reasons | Cell Downtime | Assembly Downtime -->
                            <tr>
                                <td style="padding: 10px 30px 20px 30px;">
                                    <table cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <!-- NG Reasons Column -->
                                            <td width="36%" style="vertical-align: top;">
                                                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px;">
                                                    <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #dc2626; letter-spacing: -0.02em;">NG Analysis (Today)</div>
                                                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size: 11px;">
                                                        <tr style="background: #f1f5f9;">
                                                            <th style="padding: 6px 8px; text-align: left; font-size: 10px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1;">#</th>
                                                            <th style="padding: 6px 8px; text-align: left; font-size: 10px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1;">Reason</th>
                                                            <th style="padding: 6px 8px; text-align: right; font-size: 10px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1;">Count</th>
                                                            <th style="padding: 6px 8px; text-align: right; font-size: 10px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1;">%</th>
                                                        </tr>
                                                        {ng_reasons_html if ng_reasons_html else ng_empty_html}
                                                    </table>
                                                </div>
                                            </td>
                                            <td width="2%"></td>

                                            <!-- Cell Line Downtime Column -->
                                            <td width="29%" style="vertical-align: top;">
                                                <div style="background: #fff5f5; border: 1px solid #fecaca; border-radius: 6px; padding: 14px;">
                                                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 10px;">
                                                        <tr>
                                                            <td style="font-size: 13px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em; padding-bottom: 8px; border-bottom: 2px solid #ef4444;">
                                                                Cell Line
                                                            </td>
                                                            <td align="right" style="font-size: 20px; font-weight: 800; color: #b91c1c; padding-bottom: 8px; border-bottom: 2px solid #ef4444;">
                                                                {cell_downtime_hours} hrs
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size: 11px;">
                                                        <tr style="background: #fee2e2;">
                                                            <th style="padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 700; color: #991b1b; border-bottom: 1px solid #fecaca;">#</th>
                                                            <th style="padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 700; color: #991b1b; border-bottom: 1px solid #fecaca;">Station</th>
                                                            <th style="padding: 5px 8px; text-align: right; font-size: 10px; font-weight: 700; color: #991b1b; border-bottom: 1px solid #fecaca;">Duration</th>
                                                        </tr>
                                                        {cell_dt_rows}
                                                    </table>
                                                </div>
                                            </td>
                                            <td width="2%"></td>

                                            <!-- Assembly Line Downtime Column -->
                                            <td width="29%" style="vertical-align: top;">
                                                <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 14px;">
                                                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 10px;">
                                                        <tr>
                                                            <td style="font-size: 13px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em; padding-bottom: 8px; border-bottom: 2px solid #3b82f6;">
                                                                Assembly Line
                                                            </td>
                                                            <td align="right" style="font-size: 20px; font-weight: 800; color: #1d4ed8; padding-bottom: 8px; border-bottom: 2px solid #3b82f6;">
                                                                {assembly_downtime_hours} hrs
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size: 11px;">
                                                        <tr style="background: #dbeafe;">
                                                            <th style="padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 700; color: #1e40af; border-bottom: 1px solid #bfdbfe;">#</th>
                                                            <th style="padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 700; color: #1e40af; border-bottom: 1px solid #bfdbfe;">Station</th>
                                                            <th style="padding: 5px 8px; text-align: right; font-size: 10px; font-weight: 700; color: #1e40af; border-bottom: 1px solid #bfdbfe;">Duration</th>
                                                        </tr>
                                                        {assembly_dt_rows}
                                                    </table>
                                                </div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <!-- UPH vs Downtime Charts -->
                            <tr>
                                <td style="padding: 10px 30px 10px 30px;">
                                    {uph_vs_dt_cell_chart}
                                    {uph_vs_dt_assembly_chart}
                                </td>
                            </tr>

                            <!-- Footer -->
                            <tr>
                                <td style="padding: 15px 30px 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                                    <div style="font-size: 10px; color: #94a3b8; font-weight: 500;">
                                        Leadman Production Management System | Auto-generated | Generated: {ca_now_str()}
                                    </div>
                                </td>
                            </tr>

                        </table>
                    </td>
                </tr>
            </table>

        </body>
        </html>
        """

        return html

    def _generate_risk_alert_html(self, data: dict) -> str:
        """
        生成風險警報 HTML 內容

        Args:
            data: 風險數據

        Returns:
            str: HTML 格式的郵件內容
        """
        risk_level = data.get('risk_level', 'CRITICAL')
        line_name = data.get('line_name', '')
        current_rate = data.get('current_rate', 0)
        target_rate = data.get('target_rate', 0)
        shortage = data.get('shortage', 0)
        alert_time = data.get('alert_time', ca_now_str())

        # 根據風險等級設置顏色
        risk_colors = {
            'CRITICAL': '#ef4444',
            'WARNING': '#f59e0b',
            'CAUTION': '#eab308'
        }
        risk_color = risk_colors.get(risk_level, '#ef4444')

        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{
                    font-family: 'Microsoft YaHei', Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }}
                .alert-header {{
                    background: linear-gradient(135deg, {risk_color} 0%, {risk_color}dd 100%);
                    color: white;
                    padding: 30px;
                    border-radius: 10px;
                    text-align: center;
                    margin-bottom: 30px;
                }}
                .alert-header h1 {{
                    margin: 0;
                    font-size: 32px;
                }}
                .alert-header .risk-badge {{
                    display: inline-block;
                    background: rgba(255, 255, 255, 0.3);
                    padding: 8px 20px;
                    border-radius: 20px;
                    margin-top: 15px;
                    font-weight: bold;
                    font-size: 18px;
                }}
                .info-section {{
                    background: #f9fafb;
                    border-radius: 10px;
                    padding: 25px;
                    margin-bottom: 20px;
                    border-left: 4px solid {risk_color};
                }}
                .info-row {{
                    display: flex;
                    justify-content: space-between;
                    padding: 12px 0;
                    border-bottom: 1px solid #e5e7eb;
                }}
                .info-row:last-child {{
                    border-bottom: none;
                }}
                .info-label {{
                    color: #6b7280;
                    font-weight: 600;
                }}
                .info-value {{
                    color: #1f2937;
                    font-weight: bold;
                    font-size: 18px;
                }}
                .critical-value {{
                    color: {risk_color};
                    font-size: 24px;
                }}
                .action-box {{
                    background: #fff3cd;
                    border: 2px solid #ffc107;
                    border-radius: 10px;
                    padding: 20px;
                    margin-top: 20px;
                }}
                .action-box h3 {{
                    margin: 0 0 10px 0;
                    color: #856404;
                }}
                .action-box p {{
                    margin: 0;
                    color: #856404;
                }}
                .footer {{
                    text-align: center;
                    color: #6b7280;
                    font-size: 12px;
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #e5e7eb;
                }}
            </style>
        </head>
        <body>
            <div class="alert-header">
                <h1>Warning 生產風險警報</h1>
                <div class="risk-badge">{risk_level}</div>
            </div>

            <div class="info-section">
                <div class="info-row">
                    <span class="info-label">生產線</span>
                    <span class="info-value">{line_name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">當前速率</span>
                    <span class="critical-value">{current_rate:.1f} pcs/h</span>
                </div>
                <div class="info-row">
                    <span class="info-label">目標速率</span>
                    <span class="info-value">{target_rate:.1f} pcs/h</span>
                </div>
                <div class="info-row">
                    <span class="info-label">產能缺口</span>
                    <span class="critical-value">▼ {shortage} units</span>
                </div>
                <div class="info-row">
                    <span class="info-label">警報時間</span>
                    <span class="info-value">{alert_time}</span>
                </div>
            </div>

            <div class="action-box">
                <h3>🔍 建議行動</h3>
                <p>• 立即檢查生產線狀態</p>
                <p>• 確認是否有設備故障或物料短缺</p>
                <p>• 評估是否需要調整生產計畫</p>
            </div>

            <div class="footer">
                <p>此郵件由 Leadman 生產管理系統自動生成</p>
                <p>警報時間：{alert_time}</p>
            </div>
        </body>
        </html>
        """
        return html

    def _generate_downtime_alert_html(self, data: dict) -> str:
        """
        生成停機警報 HTML 內容

        Args:
            data: 停機數據

        Returns:
            str: HTML 格式的郵件內容
        """
        line = data.get('line', 'Unknown')
        station = data.get('station', 'Unknown')
        duration_minutes = data.get('duration_minutes', 0)
        start_time = data.get('start_time', '')
        alert_time = data.get('alert_time', ca_now_str())

        # 計算時間顯示
        hours = duration_minutes // 60
        minutes = duration_minutes % 60
        duration_display = f"{hours}h {minutes}m" if hours > 0 else f"{minutes}m"

        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{
                    font-family: 'Microsoft YaHei', Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }}
                .alert-header {{
                    background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
                    color: white;
                    padding: 30px;
                    border-radius: 10px;
                    text-align: center;
                    margin-bottom: 30px;
                    animation: pulse 2s infinite;
                }}
                @keyframes pulse {{
                    0%, 100% {{ opacity: 1; }}
                    50% {{ opacity: 0.9; }}
                }}
                .alert-header h1 {{
                    margin: 0;
                    font-size: 32px;
                }}
                .duration-display {{
                    background: rgba(255, 255, 255, 0.3);
                    padding: 15px 30px;
                    border-radius: 20px;
                    margin-top: 20px;
                    font-size: 36px;
                    font-weight: bold;
                }}
                .info-section {{
                    background: #fef2f2;
                    border-radius: 10px;
                    padding: 25px;
                    margin-bottom: 20px;
                    border-left: 4px solid #dc2626;
                }}
                .info-row {{
                    display: flex;
                    justify-content: space-between;
                    padding: 12px 0;
                    border-bottom: 1px solid #fecaca;
                }}
                .info-row:last-child {{
                    border-bottom: none;
                }}
                .info-label {{
                    color: #991b1b;
                    font-weight: 600;
                }}
                .info-value {{
                    color: #1f2937;
                    font-weight: bold;
                    font-size: 18px;
                }}
                .action-box {{
                    background: #fee2e2;
                    border: 2px solid #dc2626;
                    border-radius: 10px;
                    padding: 20px;
                    margin-top: 20px;
                }}
                .action-box h3 {{
                    margin: 0 0 10px 0;
                    color: #991b1b;
                }}
                .action-box p {{
                    margin: 5px 0;
                    color: #7f1d1d;
                    font-weight: 500;
                }}
                .footer {{
                    text-align: center;
                    color: #6b7280;
                    font-size: 12px;
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #e5e7eb;
                }}
            </style>
        </head>
        <body>
            <div class="alert-header">
                <h1>🔴 停機超時警報</h1>
                <div class="duration-display">{duration_display}</div>
            </div>

            <div class="info-section">
                <div class="info-row">
                    <span class="info-label">生產線</span>
                    <span class="info-value">{line.upper()} Line</span>
                </div>
                <div class="info-row">
                    <span class="info-label">工位</span>
                    <span class="info-value">{station}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">停機時長</span>
                    <span class="info-value" style="color: #dc2626; font-size: 24px;">{duration_display}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">開始時間</span>
                    <span class="info-value">{start_time}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">警報時間</span>
                    <span class="info-value">{alert_time}</span>
                </div>
            </div>

            <div class="action-box">
                <h3>🚨 緊急行動建議</h3>
                <p>• 立即派遣維護人員前往現場</p>
                <p>• 確認停機原因並記錄</p>
                <p>• 評估對生產計畫的影響</p>
                <p>• 準備必要的備品備件</p>
                <p>• 通知相關主管和品質部門</p>
            </div>

            <div class="footer">
                <p>此郵件由 Leadman 生產管理系統自動生成</p>
                <p>警報時間：{alert_time}</p>
                <p>Warning 請立即處理此停機事件</p>
            </div>
        </body>
        </html>
        """
        return html


# 測試函數
def test_email_service():
    """測試郵件服務"""
    print("=" * 60)
    print("🧪 測試 Microsoft Graph API 郵件服務")
    print("=" * 60)

    # 創建服務實例
    try:
        email_service = GraphAPIEmailService()
    except ValueError as e:
        print(f"\n{e}")
        print("\n請先配置 .env 文件中的 Azure AD 憑證")
        return

    # 測試數據
    test_data = {
        'module_production': 1245,
        'assembly_production': 856,
        'total_ng': 125,
        'ng_reasons': [
            {'reason': 'Scratch/Damage', 'count': 45, 'percentage': 36.0},
            {'reason': 'Function Test Failed', 'count': 32, 'percentage': 25.6},
            {'reason': 'Assembly Issue', 'count': 28, 'percentage': 22.4},
            {'reason': 'Missing Parts', 'count': 12, 'percentage': 9.6},
            {'reason': 'Others', 'count': 8, 'percentage': 6.4},
        ],
        'downtime_hours': 2.5,
        'module_efficiency': 95.2,
        'assembly_efficiency': 92.8
    }

    # 發送測試郵件
    success = email_service.send_daily_report(
        recipients=["jay.chiang@leadman.com"],
        report_data=test_data
    )

    if success:
        print("\n" + "=" * 60)
        print("測試成功！請檢查你的郵箱")
        print("=" * 60)
    else:
        print("\n" + "=" * 60)
        print("測試失敗！請檢查配置和權限")
        print("=" * 60)


if __name__ == "__main__":
    # 加載環境變量
    from dotenv import load_dotenv
    load_dotenv()

    # 運行測試
    test_email_service()
