# backend/api/ai_routes.py - 文檔管理 API 路由（含：重建向量庫 / 分頁）
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import logging
import os
import tempfile
from pathlib import Path

from services.ai_service import (
    ai_engine,
    DOCUMENT_CATEGORIES,      # 允許的文件類別（由服務層維護）
    SUPPORTED_EXTENSIONS,     # 支援副檔名（.pdf/.docx/...）
    DEFAULT_OLLAMA_MODEL,     # 預設本地 LLM（Ollama）
)
from core.deps import require_roles, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["AI Document Analytics"])


# ============================== Pydantic 模型 ==============================
class QueryRequest(BaseModel):
    """
    文檔查詢請求：
      - question: 查詢問題
      - use_openai: True 時改用雲端 OpenAI；False 走本地 Ollama
      - openai_model: 使用的 OpenAI 模型（僅 use_openai=True 時有用）
    """
    question: str
    use_openai: bool = False
    openai_model: str = "gpt-4o-mini"


class DocumentResponse(BaseModel):
    """
    文檔列表回傳項（僅基礎欄位；不含全文）
    - 注意：這個模型對應 ai_engine.get_documents() 回傳的資料格式
    """
    id: int
    filename: str
    original_name: str
    category: str
    file_type: str
    file_size: int
    content_preview: str
    upload_date: str
    uploaded_by: str
    tags: Optional[str] = ""
    description: Optional[str] = ""


# ============================== 小工具 ==============================
def _username(user: Any) -> str:
    """
    從 user 物件或 dict 取 username。
    - FastAPI 的 dependency 有時是物件（.username），有時是 dict（["username"]）
    - 若兩者皆無 → 以 'unknown' 退回，避免 None 擾動 DB
    """
    return getattr(user, "username", None) or user.get("username", "unknown")


# =============================================================================
# 系統狀態和信息
# =============================================================================
@router.get("/status")
async def get_ai_status():
    """
    取得 AI 子系統狀態（完整原始值）
    - 主要給管理端/監控面板查閱
    """
    try:
        return ai_engine.get_system_status()
    except Exception as e:
        logger.error(f"Error getting AI status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/categories")
async def get_document_categories():
    """回傳可用文檔類別清單（由服務層集中管理）"""
    return {"categories": DOCUMENT_CATEGORIES}


@router.get("/health")
async def ai_health_check():
    """
    健康檢查（提供摘要/旗標）：
      - status: ready/degraded
      - vector_store_ready: 向量索引是否就緒（RAG 可用）
      - rag_mode/hyde/compression/parent_feature: 方便前端決策或監控
    """
    try:
        status = ai_engine.get_system_status()
        return {
            "service": "ai-document-analytics",
            "status": "healthy" if status.get("status") == "ready" else "degraded",
            "total_documents": status.get("total_documents", 0),
            "vector_store_ready": status.get("vector_store_ready", False),
            "ollama_model": status.get("ollama_model", DEFAULT_OLLAMA_MODEL),
            "openai_available": status.get("openai_available", False),
            # RAG 配置透出（debug/告警/AB 測試方便）
            "rag_mode": status.get("rag_mode"),
            "hyde": status.get("hyde"),
            "compression": status.get("compression"),
            "parent_feature": status.get("parent_feature"),
            "success": True,
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail="AI service unhealthy")


# =============================================================================
# 文檔管理 (需要管理員權限)
# =============================================================================
@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    category: str = Form(...),
    tags: str = Form(""),
    description: str = Form(""),
    current_user: dict = Depends(require_roles("admin")),
):
    """
    上傳文檔（僅管理員）
    - 以串流寫入臨時檔，避免一次性讀大檔（>50MB）造成記憶體尖峰
    - 驗證副檔名與分類；檔案大小超過限制會立即中止
    - 上傳成功後移交 ai_engine 解析/入庫/切塊
    """
    MAX_BYTES = 50 * 1024 * 1024  # 50MB
    try:
        # 1) 檢查副檔名白名單
        file_extension = Path(file.filename).suffix.lower()
        if file_extension not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {file_extension}. "
                       f"Supported types: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
            )

        # 2) 檢查類別是否有效
        if category not in DOCUMENT_CATEGORIES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid category. Valid: {', '.join(DOCUMENT_CATEGORIES.keys())}",
            )

        # 3) 串流寫入臨時檔；邊寫邊計數（避免 DOS 型大檔）
        total = 0
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension) as tmp:
            temp_file_path = tmp.name
            while True:
                chunk = await file.read(1024 * 1024)  # 每次讀 1MB
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")
                tmp.write(chunk)

        # 4) 交給服務層處理（抽取文字、切分 chunk、入庫與向量化）
        try:
            result = ai_engine.upload_document(
                file_path=temp_file_path,
                original_name=file.filename,
                category=category,
                uploaded_by=_username(current_user),
                tags=tags,
                description=description,
            )
            if not result.get("success"):
                # 保留服務層錯誤訊息，便於定位（權限/解析/OCR 等）
                raise HTTPException(status_code=400, detail=result.get("error", "Upload failed"))

            logger.info(f"✅ Document uploaded by {_username(current_user)}: {file.filename}")
            return {
                "success": True,
                "message": "Document uploaded successfully",
                "document_id": result["document_id"],
                "filename": result["filename"],
                "content_length": result["content_length"],
                "chunks_created": result["chunks_created"],
            }
        finally:
            # 5) 不論成功/失敗都嘗試移除臨時檔（避免殘留）
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Document upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.get("/documents", response_model=List[DocumentResponse])
async def get_documents(
    category: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    current_user: dict = Depends(require_roles("admin")),
):
    """
    取得文檔列表（僅管理員）
    - 支援分頁：skip/limit，回應 header 會附加 X-Total-Count / X-Skip / X-Limit
    - 回傳本體仍維持「清單」以相容舊前端
    """
    try:
        documents = ai_engine.get_documents(category)
        total = len(documents)
        sliced = documents[skip: skip + limit] if limit > 0 else documents[skip:]
        headers = {
            "X-Total-Count": str(total),
            "X-Skip": str(skip),
            "X-Limit": str(limit),
        }
        return JSONResponse(content=sliced, headers=headers)
    except Exception as e:
        logger.error(f"Error getting documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    current_user: dict = Depends(require_roles("admin")),
):
    """
    刪除文檔（僅管理員）
    - 僅刪除資料庫與索引的該項；實體檔案由服務層決定是否保留
    """
    try:
        success = ai_engine.delete_document(document_id)
        if not success:
            raise HTTPException(status_code=404, detail="Document not found")

        logger.info(f"✅ Document deleted by {_username(current_user)}: {document_id}")
        return {"success": True, "message": "Document deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting document: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/documents/{document_id}")
async def get_document_details(
    document_id: int,
    current_user: dict = Depends(require_roles("admin")),
):
    """
    取得文檔詳細（僅管理員）
    - 包含 content_preview / tags / description 等
    """
    try:
        document = ai_engine.get_document_by_id(document_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        return {"success": True, **document}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting document details: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# 維運：向量庫重建 / 單檔增量
# =============================================================================
@router.post("/reindex")
async def reindex_vector_store(
    current_user: dict = Depends(require_roles("admin")),
):
    """
    一鍵重建 FAISS 向量庫（不動資料表）
    - 適用：變更切塊策略 / 變更壓縮策略 / 清索引後重建
    - 會依設定自動處理 Parent-Child（若啟用 parent 特性）
    """
    try:
        ai_engine.rag_system.rebuild_vector_store()
        status = ai_engine.get_system_status()
        logger.info(
            f"🛠 重新建立向量庫完成（docs={status.get('total_documents')}, chunks={status.get('total_chunks')}）"
        )
        return {
            "success": True,
            "message": "Vector store rebuilt successfully",
            "stats": {
                "total_documents": status.get("total_documents"),
                "total_chunks": status.get("total_chunks"),
                "vector_store_ready": status.get("vector_store_ready"),
                "vector_store_size_bytes": status.get("vector_store_size_bytes"),
                "rag_mode": status.get("rag_mode"),
                "parent_feature": status.get("parent_feature"),
                "hyde": status.get("hyde"),
                "compression": status.get("compression"),
            },
        }
    except Exception as e:
        logger.error(f"Reindex error: {e}")
        raise HTTPException(status_code=500, detail=f"Reindex failed: {str(e)}")


@router.post("/reindex/{document_id}")
async def reindex_single_document(
    document_id: int,
    current_user: dict = Depends(require_roles("admin")),
):
    """
    單一文件增量入索引：
      - 只重新向量化該文件的 chunks
      - 若系統為 parent 模式，會同步刷新 parent-child 結構（純記憶體重建）
    """
    try:
        doc = ai_engine.get_document_by_id(document_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        # 1) 追加該文件的向量分片
        ai_engine.rag_system.add_document_chunks(document_id)

        # 2) parent 模式時，重建父子索引（僅重建記憶體態）
        status_before = ai_engine.get_system_status()
        if status_before.get("rag_mode") == "parent":
            # 注意：這是服務層內部安全方法；不操作磁碟，僅更新檢索結構
            ai_engine.rag_system._build_parent_child_indices()

        status_after = ai_engine.get_system_status()
        logger.info(f"🧩 單檔重建完成：{document_id}")
        return {
            "success": True,
            "message": f"Document {document_id} reindexed",
            "stats": {
                "total_documents": status_after.get("total_documents"),
                "total_chunks": status_after.get("total_chunks"),
                "vector_store_ready": status_after.get("vector_store_ready"),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reindex single document error: {e}")
        raise HTTPException(status_code=500, detail=f"Reindex failed: {str(e)}")


# =============================================================================
# 文檔下載 (所有登入用戶)
# =============================================================================
@router.get("/documents/{document_id}/download")
async def download_document(
    document_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    下載文檔（所有登入用戶）
    - 透過 ai_engine 取得檔案的實體路徑；若不存在回 404
    - FileResponse 預設以 octet-stream 下載
    """
    try:
        document = ai_engine.get_document_by_id(document_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        file_path = ai_engine.get_document_path(document_id)
        if not file_path or not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found on server")

        logger.info(f"📥 Document downloaded by {_username(current_user)}: {document['original_name']}")

        return FileResponse(
            path=str(file_path),
            filename=document["original_name"],
            media_type="application/octet-stream",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading document: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# 文檔查詢 (所有登入用戶)
# =============================================================================
@router.post("/query")
async def query_documents(
    req_body: QueryRequest,
    req: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    查詢文檔（RAG + LLM）
    流程：
      1) 檢查系統狀態（ready / 向量庫）
      2) 選擇提供商：OpenAI（雲）或 Ollama（本地）
      3) 呼叫 ai_engine.query_documents()
      4) 若回答中包含相對下載路徑，轉為絕對 URL（避免前端相對路徑錯誤）
      5) 回應 header 透出 RAG 配置，便於除錯或監控
    """
    try:
        ai_provider = "OpenAI" if req_body.use_openai else "Ollama"
        logger.info(f"🤖 Processing document query with {ai_provider}: {req_body.question[:100]}...")

        # 基礎健康：避免在索引未就緒時讓使用者遇到不穩定體驗
        status = ai_engine.get_system_status()
        if status.get("status") != "ready":
            raise HTTPException(status_code=400, detail="Document system not ready. Please contact administrator.")

        # 無資料時直接回覆（可引導管理員先上傳文件）
        if status.get("total_documents", 0) == 0:
            raise HTTPException(status_code=400, detail="No documents available. Please upload documents first.")

        # 選擇 OpenAI 時需確認 OPENAI_API_KEY 是否已配置
        if req_body.use_openai and not status.get("openai_available"):
            raise HTTPException(
                status_code=400,
                detail="OpenAI not available. Please set OPENAI_API_KEY or use Ollama.",
            )

        # 實際查詢（包含檢索、重排、生成/OA rerank 視服務層配置）
        result = ai_engine.query_documents(req_body.question, req_body.use_openai, req_body.openai_model)

        # 統一錯誤處理（result 內含 status/answer 訊息）
        if result.get("status") == "error":
            logger.error(f"Query processing error: {result.get('answer')}")
            raise HTTPException(status_code=500, detail=result.get("answer", "Query error"))
        if result.get("status") == "no_documents":
            raise HTTPException(status_code=404, detail=result.get("answer", "No related documents"))

        logger.info(
            f"✅ Document query processed successfully with {ai_provider} - Type: {result.get('query_type', 'general')}"
        )

        # 轉換相對下載連結 → 絕對 URL（API Gateway 或子路徑部署時尤其需要）
        answer = result.get("answer", "")
        if "documents_found" in result or "/api/ai/documents/" in answer:
            base = f"{req.url.scheme}://{req.url.netloc}"
            answer = answer.replace("/api/ai/documents/", f"{base}/api/ai/documents/")

        payload = {
            "success": True,
            "answer": answer,
            "source_documents": result.get("source_documents", []),  # 可選：用於前端展開證據
            "query_type": result.get("query_type"),
            "ai_provider": result.get("ai_provider"),
            "user": _username(current_user),
        }

        # 回應頭附帶 RAG 配置（不影響 JSON 本體）
        headers = {
            "X-AI-Provider": payload["ai_provider"] or "",
            "X-RAG-Mode": str(status.get("rag_mode", "")),
            "X-RAG-HyDE": "1" if status.get("hyde") else "0",
            "X-RAG-Compression": "1" if status.get("compression") else "0",
        }
        return JSONResponse(content=payload, headers=headers)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in document query: {e}")
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


# =============================================================================
# 公開（基本）文檔列表 (所有登入用戶，不含完整內容)
# =============================================================================
@router.get("/documents/public/list")
async def get_public_documents(
    category: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
):
    """
    取得公開文檔（所有登入用戶）
    - 僅回必要欄位 & content_preview（最多 200 字）
    - 支援分頁；保留 total/returned/skip/limit 以利前端分頁 UI
    """
    try:
        documents = ai_engine.get_documents(category)
        sliced = documents[skip: skip + limit] if limit > 0 else documents[skip:]

        public_docs = []
        for doc in sliced:
            preview = doc.get("content_preview") or ""
            public_docs.append({
                "id": doc["id"],
                "original_name": doc["original_name"],
                "category": doc["category"],
                "file_type": doc["file_type"],
                "upload_date": doc["upload_date"],
                "tags": doc.get("tags"),
                "description": doc.get("description"),
                "content_preview": (preview[:200] + "...") if len(preview) > 200 else preview,
            })

        return {
            "success": True,
            "documents": public_docs,
            "total": len(documents),
            "returned": len(public_docs),
            "skip": skip,
            "limit": limit,
            "categories": DOCUMENT_CATEGORIES,
        }
    except Exception as e:
        logger.error(f"Error getting public documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# AI 提供商測試（僅管理員）
# =============================================================================
@router.post("/test-openai")
async def test_openai_connection(
    current_user: dict = Depends(require_roles("admin")),
):
    """
    偵測 OpenAI 連通性：
      - 直接呼叫服務層 openai_generate() 並要求固定字串
      - 若環境未設 OPENAI_API_KEY 會在服務層拋錯
    """
    try:
        from services.ai_service import openai_generate

        test_response = openai_generate(
            "Please respond with exactly: 'OpenAI connection successful for document analysis'",
            "gpt-4o-mini",
        )
        return {
            "success": True,
            "status": "connected",
            "provider": "openai",
            "model": "gpt-4o-mini",
            "response": test_response,
        }
    except Exception as e:
        logger.error(f"OpenAI test failed: {e}")
        return {"success": False, "status": "failed", "provider": "openai", "error": str(e)}


@router.post("/test-ollama")
async def test_ollama_connection(
    current_user: dict = Depends(require_roles("admin")),
):
    """
    偵測 Ollama 連通性（本地 LLM）：
      - 直接呼叫服務層 ollama_generate() 並要求固定字串
      - 若主機未有該模型會回錯誤（請先在主機 pull 模型）
    """
    try:
        from services.ai_service import ollama_generate

        test_response = ollama_generate(
            "Please respond with exactly: 'Ollama connection successful for document analysis'",
            DEFAULT_OLLAMA_MODEL,
        )
        return {
            "success": True,
            "status": "connected",
            "provider": "ollama",
            "model": DEFAULT_OLLAMA_MODEL,
            "response": test_response,
        }
    except Exception as e:
        logger.error(f"Ollama test failed: {e}")
        return {"success": False, "status": "failed", "provider": "ollama", "error": str(e)}


# =============================================================================
# 常見查詢和幫助（靜態建議）
# =============================================================================
@router.get("/common-queries")
async def get_common_queries():
    """
    前端可用的「常見查詢」面板：
      - 根據使用情境列出範例問題，降低使用門檻
      - 亦可根據實際 SOP/表單命名做更貼合的提示
    """
    return {
        "success": True,
        "queries": [
            {
                "category": "SOP Inquiries",
                "questions": [
                    "How do I perform quality inspection according to SOP?",
                    "What are the safety procedures for equipment maintenance?",
                    "Can you explain the step-by-step process for [specific procedure]?",
                    "What should I do if I encounter [specific issue] during production?",
                ],
            },
            {
                "category": "Form Assistance",
                "questions": [
                    "How do I fill out the quality inspection form?",
                    "What information is required for the maintenance checklist?",
                    "Can you help me complete the incident report form?",
                    "What are the required fields for [specific form]?",
                ],
            },
            {
                "category": "Document Requests",
                "questions": [
                    "I need the quality inspection form",
                    "Give me the equipment maintenance checklist",
                    "Download the safety procedures document",
                    "Find the production SOP template",
                ],
            },
            {
                "category": "Process Improvement",
                "questions": [
                    "How can we improve the current quality control process?",
                    "What are potential bottlenecks in our production workflow?",
                    "Can you suggest ways to reduce downtime in [specific area]?",
                    "How can we make our documentation more efficient?",
                ],
            },
            {
                "category": "Policy and Compliance",
                "questions": [
                    "What are the current safety regulations?",
                    "How do we ensure compliance with quality standards?",
                    "What documentation is required for audit purposes?",
                    "Can you explain the company policy on [specific topic]?",
                ],
            },
        ],
        "ai_recommendations": {
            "ollama": {
                "description": "適合一般 SOP 查詢和基本文檔分析",
                "best_for": ["標準程序查詢", "表格填寫指導", "基本問題解答"],
            },
            "openai": {
                "description": "適合複雜分析和深度改進建議",
                "best_for": ["流程改進分析", "根本原因分析", "戰略性建議"],
            },
        },
        "tips": [
            "Be specific about which document or process you're asking about",
            "Use keywords like 'I need', 'Give me', 'Download' to request specific documents",
            "Ask for step-by-step instructions when needed",
            "Request examples or clarifications if something is unclear",
            "Ask about potential improvements or alternative approaches",
        ],
    }


@router.get("/supported-formats")
async def get_supported_formats():
    """
    列出支援的檔案格式與注意事項：
      - 圖片會先做 OCR 轉文字再索引
      - 表格檔（Excel/CSV）會抽取表格成可檢索的文字預覽
      - 全數文件皆會進 RAG 索引（FAISS）
    """
    format_descriptions = {
        ".pdf": "PDF documents",
        ".docx": "Microsoft Word documents",
        ".doc": "Legacy Word documents",
        ".txt": "Plain text files",
        ".md": "Markdown files",
        ".xlsx": "Excel spreadsheets",
        ".xls": "Legacy Excel files",
        ".csv": "CSV data files",
        ".png": "PNG images (with OCR)",
        ".jpg": "JPEG images (with OCR)",
        ".jpeg": "JPEG images (with OCR)",
        ".tiff": "TIFF images (with OCR)",
    }

    return {
        "success": True,
        "supported_extensions": sorted(list(SUPPORTED_EXTENSIONS)),
        "format_descriptions": format_descriptions,
        "max_file_size": "50MB",
        "notes": [
            "Images will be processed using OCR to extract text",
            "Excel/CSV files will be converted to textual preview for indexing",
            "All uploaded documents are automatically indexed for RAG search",
            "Use 'I need [document name]' to request specific documents",
        ],
    }
