"""
Email Settings API Endpoints
Provides REST API for email configuration, recipients, and history management
Admin-only access required for all endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

from core.deps import get_current_user, require_admin
from core.rate_limiter import get_rate_limiter
from core.monitor_db import log_audit
from core.email_db import (
    get_email_config,
    update_email_config,
    get_all_recipients,
    get_active_recipients,
    add_recipient,
    delete_recipient,
    toggle_recipient,
    get_email_history,
    log_email_send
)
from services.email_service import GraphAPIEmailService
from services.data_collection_service import DataCollectionService

router = APIRouter(prefix="/email-settings", tags=["Email Settings"])

# Pydantic Models

class EmailConfig(BaseModel):
    """Email configuration model"""
    send_time: str
    enabled: bool

class EmailConfigResponse(BaseModel):
    """Email configuration response model"""
    id: int
    send_time: str
    enabled: bool
    updated_at: Optional[datetime]
    updated_by: str

class EmailRecipient(BaseModel):
    """Email recipient model"""
    email: EmailStr
    display_name: Optional[str] = None

class EmailRecipientResponse(BaseModel):
    """Email recipient response model"""
    id: int
    email: str
    display_name: Optional[str]
    is_active: bool
    created_at: Optional[datetime]
    created_by: str

class EmailHistoryResponse(BaseModel):
    """Email history response model"""
    id: int
    sent_at: Optional[datetime]
    recipients: str
    status: str
    error_message: Optional[str]
    triggered_by: str

class TestEmailRequest(BaseModel):
    """Test email request model"""
    recipient_email: Optional[EmailStr] = None

class ToggleRecipientRequest(BaseModel):
    """Toggle recipient active status"""
    is_active: bool


# API Endpoints

@router.get("/config", response_model=EmailConfigResponse, dependencies=[Depends(require_admin)])
async def get_config(current_user: dict = Depends(get_current_user)):
    """
    Get current email configuration
    Admin-only endpoint
    """
    config = get_email_config()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email configuration not found"
        )

    return EmailConfigResponse(
        id=config["id"],
        send_time=config["send_time"],
        enabled=bool(config["enabled"]),
        updated_at=config["updated_at"],
        updated_by=config["updated_by"]
    )


@router.put("/config", dependencies=[Depends(require_admin)])
async def update_config(
    config: EmailConfig,
    current_user: dict = Depends(get_current_user)
):
    """
    Update email configuration and reload scheduler
    Admin-only endpoint
    """
    import logging
    logger = logging.getLogger(__name__)

    # Validate time format (HH:MM)
    try:
        hour, minute = config.send_time.split(":")
        if not (0 <= int(hour) <= 23 and 0 <= int(minute) <= 59):
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid time format. Use HH:MM (e.g., 18:00)"
        )

    # Update config in database
    success = update_email_config(
        send_time=config.send_time,
        enabled=config.enabled,
        updated_by=current_user.username
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update email configuration"
        )

    log_audit(user=current_user.username, action="email_config_update",
              target="email_config", new_value=f"time={config.send_time}, enabled={config.enabled}")

    # Reload scheduler to apply new configuration immediately
    try:
        from core.scheduler import get_scheduler
        scheduler = get_scheduler()
        scheduler.reload_schedule()
        logger.info(f"Scheduler reloaded after config update by {current_user.username}")
    except Exception as e:
        logger.error(f"Failed to reload scheduler: {e}")
        # Don't fail the request, just log the error
        return {
            "success": True,
            "message": "Email configuration updated successfully, but scheduler reload failed",
            "warning": "Scheduler will reload on next server restart",
            "config": {
                "send_time": config.send_time,
                "enabled": config.enabled
            }
        }

    return {
        "success": True,
        "message": "Email configuration updated and scheduler reloaded successfully",
        "config": {
            "send_time": config.send_time,
            "enabled": config.enabled
        }
    }


@router.get("/recipients", response_model=List[EmailRecipientResponse], dependencies=[Depends(require_admin)])
async def get_recipients(
    active_only: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """
    Get all email recipients
    Admin-only endpoint

    Query params:
    - active_only: Return only active recipients (default: False)
    """
    if active_only:
        recipients = get_active_recipients()
    else:
        # get_all_recipients now returns dict with pagination info
        result = get_all_recipients()
        recipients = result["items"]

    return [
        EmailRecipientResponse(
            id=r["id"],
            email=r["email"],
            display_name=r["display_name"],
            is_active=bool(r["is_active"]),
            created_at=r["created_at"],
            created_by=r["created_by"]
        )
        for r in recipients
    ]


@router.post("/recipients", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def create_recipient(
    recipient: EmailRecipient,
    current_user: dict = Depends(get_current_user)
):
    """
    Add new email recipient
    Admin-only endpoint
    """
    recipient_id = add_recipient(
        email=recipient.email,
        display_name=recipient.display_name or recipient.email.split("@")[0],
        created_by=current_user.username
    )

    if not recipient_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Email {recipient.email} already exists"
        )

    return {
        "success": True,
        "message": "Recipient added successfully",
        "recipient_id": recipient_id,
        "email": recipient.email
    }


@router.delete("/recipients/{recipient_id}", dependencies=[Depends(require_admin)])
async def remove_recipient(
    recipient_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Delete email recipient
    Admin-only endpoint
    """
    success = delete_recipient(recipient_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recipient with ID {recipient_id} not found"
        )

    return {
        "success": True,
        "message": "Recipient deleted successfully",
        "recipient_id": recipient_id
    }


@router.patch("/recipients/{recipient_id}/toggle", dependencies=[Depends(require_admin)])
async def toggle_recipient_status(
    recipient_id: int,
    request: ToggleRecipientRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Toggle recipient active status
    Admin-only endpoint
    """
    success = toggle_recipient(recipient_id, request.is_active)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recipient with ID {recipient_id} not found"
        )

    return {
        "success": True,
        "message": f"Recipient {'activated' if request.is_active else 'deactivated'} successfully",
        "recipient_id": recipient_id,
        "is_active": request.is_active
    }


@router.post("/test-email", dependencies=[Depends(require_admin)])
async def send_test_email(
    http_request: Request,
    test_request: TestEmailRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Send test email immediately
    Admin-only endpoint
    Rate limited to 5 requests per minute per user

    Body params:
    - recipient_email: Optional specific recipient, defaults to all active recipients
    """
    import logging
    logger = logging.getLogger(__name__)

    # Apply rate limiting: 5 requests per minute per user
    rate_limiter = get_rate_limiter()
    rate_key = f"test-email:{current_user.username}"
    is_allowed, remaining = rate_limiter.is_allowed(rate_key, max_requests=5, window_seconds=60)

    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Maximum 5 test emails per minute. Please try again later."
        )

    try:
        logger.info(f"📧 Test email requested by {current_user.username}")

        # Get recipients
        if test_request.recipient_email:
            recipients = [test_request.recipient_email]
            logger.info(f"  Sending to specific recipient: {test_request.recipient_email}")
        else:
            recipient_list = get_active_recipients()
            recipients = [r["email"] for r in recipient_list]
            logger.info(f"  Sending to {len(recipients)} active recipients")

        if not recipients:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No active recipients found"
            )

        # Collect data
        logger.info("  Collecting report data...")
        data_service = DataCollectionService()
        report_data = data_service.get_daily_report_data()
        logger.info(f"  Report data collected: {list(report_data.keys())}")

        # Send email
        logger.info("  Initializing email service...")
        email_service = GraphAPIEmailService()
        logger.info("  Email service initialized, sending report...")
        success = email_service.send_daily_report(
            recipients=recipients,
            report_data=report_data
        )
        logger.info(f"  Email send result: {success}")

        # Log the send attempt
        log_email_send(
            recipients=recipients,
            status="success" if success else "failed",
            error_message=None if success else "Email send failed",
            triggered_by=f"manual:{current_user.username}"
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send test email"
            )

        return {
            "success": True,
            "message": "Test email sent successfully",
            "recipients": recipients,
            "sent_at": datetime.now().isoformat()
        }

    except Exception as e:
        logger.error(f"Test email error: {e}", exc_info=True)

        # Log failed attempt
        log_email_send(
            recipients=recipients if 'recipients' in locals() else [],
            status="error",
            error_message=str(e),
            triggered_by=f"manual:{current_user.username}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error sending test email: {str(e)}"
        )


@router.get("/history", response_model=List[EmailHistoryResponse], dependencies=[Depends(require_admin)])
async def get_history(
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """
    Get email send history
    Admin-only endpoint

    Query params:
    - limit: Maximum number of records to return (default: 50, max: 200)
    """
    if limit > 200:
        limit = 200

    history = get_email_history(limit=limit)

    return [
        EmailHistoryResponse(
            id=h["id"],
            sent_at=h["sent_at"],
            recipients=h["recipients"],
            status=h["status"],
            error_message=h["error_message"],
            triggered_by=h["triggered_by"]
        )
        for h in history
    ]


@router.get("/preview", dependencies=[Depends(require_admin)])
async def get_report_preview(current_user: dict = Depends(get_current_user)):
    """
    Get report data preview without sending email
    Admin-only endpoint
    """
    try:
        data_service = DataCollectionService()
        report_data = data_service.get_daily_report_data()

        return {
            "success": True,
            "preview_data": report_data,
            "generated_at": datetime.now().isoformat()
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating preview: {str(e)}"
        )
