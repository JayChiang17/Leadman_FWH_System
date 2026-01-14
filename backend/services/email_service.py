"""
Email Service - Microsoft Graph API
使用 Microsoft Graph API 直接發送郵件
"""
import requests
import os
from typing import List
from datetime import datetime
import msal
from dotenv import load_dotenv
from core.time_utils import ca_now, ca_now_str

# Load environment variables
load_dotenv()


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
                "❌ 未配置 Azure AD 憑證，請檢查 .env 文件：\n"
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

        print("Graph API Email Service initialized")

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
                print("No valid recipients")
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

            print(f"Sending email...")
            print(f"   Subject: {subject}")
            print(f"   Recipients: {', '.join(recipients)}")

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
                print(f"Email sent successfully!")
                return True
            else:
                print(f"Email send failed!")
                print(f"   Status code: {response.status_code}")
                print(f"   Response: {response.text}")
                return False

        except requests.exceptions.Timeout:
            print(f"Email send timeout (30 seconds)")
            return False

        except requests.exceptions.RequestException as e:
            print(f"Network error: {e}")
            return False

        except Exception as e:
            print(f"Error sending email: {e}")
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
        subject = f"⚠️ 生產風險警報 - {risk_level} - {line_name}"

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
        module_plan = data.get('module_plan', 120)
        assembly_count = data.get('assembly_production', 0)
        assembly_plan = data.get('assembly_plan', 120)
        total_ng = data.get('total_ng', 0)
        ng_reasons = data.get('ng_reasons', [])
        downtime_hours = data.get('downtime_hours', 0)
        downtime_details = data.get('downtime_details', [])
        downtime_by_line = data.get('downtime_by_line', [])
        module_efficiency = data.get('module_efficiency', 0)
        assembly_efficiency = data.get('assembly_efficiency', 0)
        module_a_hourly = data.get('module_a_hourly', [])
        module_b_hourly = data.get('module_b_hourly', [])
        assembly_hourly = data.get('assembly_hourly', [])
        module_total_hourly = data.get('module_total_hourly', [])
        assembly_total_hourly = data.get('assembly_total_hourly', [])
        downtime_cell_hourly = data.get('downtime_cell_hourly', [])
        downtime_assembly_hourly = data.get('downtime_assembly_hourly', [])

        # Generate hourly production chart with A/B lines (side-by-side bars) - COMPACT PREMIUM DESIGN
        def generate_dual_line_chart(data_a, data_b, color_a, color_b, label):
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
                            <td colspan="3" style="text-align: center; padding: 0 0 3px 0; font-size: 10px; font-weight: 700; color: #000000; border: none; line-height: 1;">
                                {hour:02d}h
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
                            <span style="font-size: 11px; font-weight: 600; color: #000000; margin: 0 8px 0 4px;">A</span>
                            <span style="display: inline-block; width: 12px; height: 12px; background-color: {color_b}; vertical-align: middle;"></span>
                            <span style="font-size: 11px; font-weight: 600; color: #000000; margin-left: 4px;">B</span>
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
                            <td style="text-align: center; padding: 0 0 3px 0; font-size: 10px; font-weight: 700; color: #000000; border: none; line-height: 1;">
                                {hour:02d}h
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
                            <td colspan="3" style="text-align: center; padding: 0 0 3px 0; font-size: 10px; font-weight: 700; color: #000000; border: none; line-height: 1;">
                                {hour:02d}h
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
                            <span style="font-size: 11px; font-weight: 600; color: #000000; margin: 0 8px 0 4px;">UPH</span>
                            <span style="display: inline-block; width: 12px; height: 12px; background-color: {color_dt}; vertical-align: middle;"></span>
                            <span style="font-size: 11px; font-weight: 600; color: #000000; margin-left: 4px;">Downtime (min)</span>
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

        module_chart = generate_dual_line_chart(module_a_hourly, module_b_hourly, '#1e40af', '#3b82f6', 'Module Hourly Production (Line A & B)')
        assembly_chart = generate_single_chart(assembly_hourly, '#059669', 'Assembly Hourly Production')

        if not module_total_hourly:
            module_total_hourly = merge_hourly_totals(module_a_hourly, module_b_hourly)
        if not assembly_total_hourly:
            assembly_total_hourly = assembly_hourly

        uph_vs_dt_cell_chart = generate_uph_downtime_chart(
            module_total_hourly,
            downtime_cell_hourly,
            '#2563eb',
            '#ef4444',
            'UPH vs Downtime - Today (Cell Line)'
        )
        uph_vs_dt_assembly_chart = generate_uph_downtime_chart(
            assembly_total_hourly,
            downtime_assembly_hourly,
            '#2563eb',
            '#ef4444',
            'UPH vs Downtime - Today (Assembly Line)'
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

        # Generate downtime details HTML - TOP 5 LONGEST DOWNTIME
        downtime_details_html = ""
        for idx, dt in enumerate(downtime_details[:5], 1):
            duration_hours = dt['duration_minutes'] / 60
            duration_display = f"{int(duration_hours)}h {int(dt['duration_minutes'] % 60)}m" if duration_hours >= 1 else f"{int(dt['duration_minutes'])}m"
            downtime_details_html += f"""
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 6px 8px; color: #64748b; font-weight: 600;">{idx}</td>
                <td style="padding: 6px 8px; color: #334155; font-weight: 600;">{dt['line']}</td>
                <td style="padding: 6px 8px; color: #334155;">{dt['station']}</td>
                <td style="padding: 6px 8px; text-align: right; color: #dc2626; font-weight: 700;">{duration_display}</td>
            </tr>
            """

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

                            <!-- Header -->
                            <tr>
                                <td style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 24px 30px; border-radius: 8px 8px 0 0;">
                                    <table cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td>
                                                <div style="font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Daily Production Report</div>
                                                <div style="font-size: 26px; font-weight: 800; color: white; letter-spacing: -0.5px;">FranklinWH</div>
                                            </td>
                                            <td align="right">
                                                <div style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); padding: 8px 14px; border-radius: 6px; display: inline-block;">
                                                    <div style="font-size: 10px; color: rgba(255,255,255,0.9); font-weight: 600; margin-bottom: 2px;">DATE</div>
                                                    <div style="font-size: 15px; color: white; font-weight: 700; letter-spacing: 0.3px;">{today}</div>
                                                </div>
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
                                            <!-- Module Production Card -->
                                            <td width="32%" style="background: #eff6ff; border: 2px solid #3b82f6; border-radius: 6px; padding: 18px; vertical-align: top;">
                                                <div style="font-size: 11px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Module Production</div>
                                                <div style="font-size: 38px; font-weight: 800; color: #1e3a8a; line-height: 1; margin-bottom: 4px;">
                                                    {module_count}<span style="font-size: 18px; font-weight: 600; color: #64748b;"> / {module_plan}</span>
                                                </div>
                                                <div style="font-size: 13px; font-weight: 600; color: {'#059669' if module_efficiency >= 90 else '#f59e0b' if module_efficiency >= 70 else '#dc2626'};">
                                                    {module_efficiency}% Efficiency
                                                </div>
                                            </td>
                                            <td width="2%"></td>
                                            <!-- Assembly Production Card -->
                                            <td width="32%" style="background: #f0fdf4; border: 2px solid #10b981; border-radius: 6px; padding: 18px; vertical-align: top;">
                                                <div style="font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Assembly Production</div>
                                                <div style="font-size: 38px; font-weight: 800; color: #065f46; line-height: 1; margin-bottom: 4px;">
                                                    {assembly_count}<span style="font-size: 18px; font-weight: 600; color: #64748b;"> / {assembly_plan}</span>
                                                </div>
                                                <div style="font-size: 13px; font-weight: 600; color: {'#059669' if assembly_efficiency >= 90 else '#f59e0b' if assembly_efficiency >= 70 else '#dc2626'};">
                                                    {assembly_efficiency}% Efficiency
                                                </div>
                                            </td>
                                            <td width="2%"></td>
                                            <!-- NG Card -->
                                            <td width="32%" style="background: #fef2f2; border: 2px solid #ef4444; border-radius: 6px; padding: 18px; text-align: center; vertical-align: top;">
                                                <div style="font-size: 11px; font-weight: 700; color: #dc2626; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Total NG Today</div>
                                                <div style="font-size: 44px; font-weight: 800; color: #991b1b; line-height: 1;">
                                                    {total_ng}
                                                </div>
                                            </td>
                                        </tr>
                                    </table>
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

                            <!-- 2-Column: NG Reasons + Downtime -->
                            <tr>
                                <td style="padding: 10px 30px 20px 30px;">
                                    <table cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <!-- NG Reasons Column -->
                                            <td width="48%" style="vertical-align: top;">
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
                                            <td width="4%"></td>
                                            <!-- Downtime Column -->
                                            <td width="48%" style="vertical-align: top;">
                                                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px;">
                                                    <div style="margin-bottom: 10px;">
                                                        <table cellspacing="0" cellpadding="0" border="0" width="100%">
                                                            <tr>
                                                                <td style="font-size: 13px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em; padding-bottom: 8px; border-bottom: 2px solid #f59e0b;">Top 5 Downtime Events</td>
                                                                <td align="right" style="font-size: 22px; font-weight: 800; color: #92400e; padding-bottom: 8px; border-bottom: 2px solid #f59e0b;">{downtime_hours} hrs</td>
                                                            </tr>
                                                        </table>
                                                    </div>
                                                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size: 11px; margin-top: 8px;">
                                                        <tr style="background: #f1f5f9;">
                                                            <th style="padding: 6px 8px; text-align: left; font-size: 10px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1;">#</th>
                                                            <th style="padding: 6px 8px; text-align: left; font-size: 10px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1;">Line</th>
                                                            <th style="padding: 6px 8px; text-align: left; font-size: 10px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1;">Station</th>
                                                            <th style="padding: 6px 8px; text-align: right; font-size: 10px; font-weight: 700; color: #475569; border-bottom: 1px solid #cbd5e1;">Duration</th>
                                                        </tr>
                                                        {downtime_details_html if downtime_details_html else '<tr><td colspan="4" style="padding: 12px; text-align: center; color: #94a3b8; font-style: italic;">No downtime records today</td></tr>'}
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
                <h1>⚠️ 生產風險警報</h1>
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
                <p>⚠️ 請立即處理此停機事件</p>
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
        print("✅ 測試成功！請檢查你的郵箱")
        print("=" * 60)
    else:
        print("\n" + "=" * 60)
        print("❌ 測試失敗！請檢查配置和權限")
        print("=" * 60)


if __name__ == "__main__":
    # 加載環境變量
    from dotenv import load_dotenv
    load_dotenv()

    # 運行測試
    test_email_service()
