# backend/services/ai_service.py - 文檔管理 AI 服務（完整版，可直接替換）
# -*- coding: utf-8 -*-

import os
import requests
import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
import pandas as pd
from pathlib import Path
import hashlib
import logging
import re
import shutil
import warnings  # ← 新增：抑制特定警告

# 精準抑制：不影響其他 FutureWarning
warnings.filterwarnings(
    "ignore",
    message="`encoder_attention_mask` is deprecated and will be removed in version 4.55.0",
    category=FutureWarning,
)
warnings.filterwarnings(
    "ignore",
    message="Valid config keys have changed in V2",
    category=UserWarning,
)

# ─────────────────────────── 檔案/OCR 依賴 ───────────────────────────
import PyPDF2
import docx
import openpyxl  # noqa: F401  # for .xlsx
from PIL import Image
import pytesseract  # OCR for images

# ─────────────────────────── LangChain / 向量庫 ───────────────────────────
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain.prompts import PromptTemplate
from langchain.schema import Document

# Parent-Child / Contextual Compression / HyDE
from langchain.retrievers import ParentDocumentRetriever, ContextualCompressionRetriever
from langchain.storage import InMemoryStore
from langchain.retrievers.document_compressors import (
    EmbeddingsFilter,
    DocumentCompressorPipeline,
)

# OpenAI（可選）
try:
    from langchain.retrievers.contextual_compression import LLMChainExtractor
    from langchain_openai import ChatOpenAI
except Exception:
    LLMChainExtractor = None
    ChatOpenAI = None

# FAISS 低階構件 + Docstore（為了建立空索引）
import faiss
from langchain_community.docstore import InMemoryDocstore

# ─────────────────────────── 基本設定 ───────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("services.ai_service")

# 儲存目錄
DOCUMENTS_DIR = Path("documents")
DOCUMENTS_DIR.mkdir(exist_ok=True)

INDEX_DIR = Path("vectorstore")
INDEX_DIR.mkdir(exist_ok=True)

# 是否啟用 SQLite FTS5（若環境不支援會自動 fallback）
USE_FTS = True

# 支援副檔名
SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".txt", ".md",
    ".xlsx", ".xls", ".csv",
    ".png", ".jpg", ".jpeg", ".tiff"
}

# 類別
DOCUMENT_CATEGORIES = {
    "sop": "Standard Operating Procedures",
    "form": "Forms and Templates",
    "manual": "Manuals and Guides",
    "policy": "Policies and Regulations",
    "checklist": "Checklists",
    "other": "Other Documents",
}

# 預設 Ollama 模型
DEFAULT_OLLAMA_MODEL = "gpt-oss:20b"  # 你可改回 deepseek-r1:14b


# ─────────────────────────── 工具類：文件/DB/擷取/切塊 ───────────────────────────
class DocumentManager:
    """文檔管理：SQLite + 檔案 CRUD + 文字擷取 + 切塊 + FTS"""

    def __init__(self, db_path: str = "documents.db"):
        self.db_path = db_path
        self.fts_enabled = False
        self._init_database()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA temp_store=MEMORY;")
        return conn

    def _init_database(self):
        with self._connect() as conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                category TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_size INTEGER,
                file_hash TEXT UNIQUE,
                content_preview TEXT,
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                uploaded_by TEXT,
                status TEXT DEFAULT 'active',
                tags TEXT,
                description TEXT
            )""")
            conn.execute("""
            CREATE TABLE IF NOT EXISTS document_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL,
                chunk_index INTEGER,
                content TEXT,
                chunk_size INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
            )""")
            conn.execute("CREATE INDEX IF NOT EXISTS ix_docs_status_cat ON documents(status, category);")
            conn.execute("CREATE INDEX IF NOT EXISTS ix_docs_hash ON documents(file_hash);")
            conn.execute("CREATE INDEX IF NOT EXISTS ix_chunks_doc ON document_chunks(document_id);")

            if USE_FTS:
                try:
                    conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                        original_name, tags, description, content='',
                        tokenize='unicode61'
                    )""")
                    conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                        content, document_id UNINDEXED, chunk_id UNINDEXED,
                        tokenize='unicode61'
                    )""")
                    self.fts_enabled = True
                    logger.info("✅ SQLite FTS5 已啟用")
                except Exception as e:
                    self.fts_enabled = False
                    logger.warning(f"⚠️ 無法建立 FTS5，將使用 LIKE fallback：{e}")

    # ────────────── 基礎工具 ──────────────
    def get_file_hash(self, file_path: str) -> str:
        h = hashlib.md5()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                h.update(chunk)
        return h.hexdigest()

    # ────────────── 文字擷取 ──────────────
    def extract_text_from_file(self, file_path: str, file_type: str) -> tuple[str, str]:
        try:
            if file_type == ".pdf":
                return self._extract_from_pdf(file_path)
            elif file_type in [".docx", ".doc"]:
                return self._extract_from_docx(file_path)
            elif file_type in [".txt", ".md"]:
                return self._extract_from_text(file_path)
            elif file_type in [".xlsx", ".xls", ".csv"]:
                return self._extract_from_excel(file_path)
            elif file_type in [".png", ".jpg", ".jpeg", ".tiff"]:
                return self._extract_from_image(file_path)
            else:
                return "", f"Unsupported file type: {file_type}"
        except Exception as e:
            logger.exception(f"Error extracting text: {file_path}")
            return "", f"Error: {str(e)}"

    def _extract_from_pdf(self, file_path: str) -> tuple[str, str]:
        """PDF 抽取；頁面抽不到字時，對前 5 頁試小成本 OCR"""
        try:
            text = ""
            with open(file_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                for i, page in enumerate(reader.pages):
                    ptxt = page.extract_text() or ""
                    if not ptxt.strip() and i < 5:
                        try:
                            from pdf2image import convert_from_path  # type: ignore
                            imgs = convert_from_path(file_path, first_page=i+1, last_page=i+1, dpi=200)
                            if imgs:
                                ptxt = pytesseract.image_to_string(imgs[0], lang="eng+chi_tra+chi_sim")
                        except Exception:
                            pass
                    text += ptxt + "\n"
            return text.strip(), ""
        except Exception as e:
            return "", f"PDF extraction error: {str(e)}"

    def _extract_from_docx(self, file_path: str) -> tuple[str, str]:
        try:
            doc = docx.Document(file_path)
            text = "\n".join([p.text for p in doc.paragraphs])
            return text.strip(), ""
        except Exception as e:
            return "", f"DOCX extraction error: {str(e)}"

    def _extract_from_text(self, file_path: str) -> tuple[str, str]:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read().strip(), ""
        except UnicodeDecodeError:
            try:
                with open(file_path, "r", encoding="gbk", errors="ignore") as f:
                    return f.read().strip(), ""
            except Exception as e:
                return "", f"Text extraction error: {str(e)}"
        except Exception as e:
            return "", f"Text extraction error: {str(e)}"

    def _extract_from_excel(self, file_path: str) -> tuple[str, str]:
        try:
            if file_path.endswith(".csv"):
                try:
                    df = pd.read_csv(file_path)
                except UnicodeDecodeError:
                    df = pd.read_csv(file_path, encoding="utf-8", errors="ignore")
            else:
                df = pd.read_excel(file_path)
            text = f"File: {os.path.basename(file_path)}\n"
            text += f"Columns: {', '.join(map(str, df.columns.tolist()))}\n"
            text += f"Rows: {len(df)}\n\nContent Preview:\n"
            text += df.head(10).to_string()
            return text, ""
        except Exception as e:
            return "", f"Excel extraction error: {str(e)}"

    def _extract_from_image(self, file_path: str) -> tuple[str, str]:
        try:
            image = Image.open(file_path)
            text = pytesseract.image_to_string(image, lang="eng+chi_tra+chi_sim")
            return text.strip(), ""
        except Exception as e:
            return "", f"OCR extraction error: {str(e)}"

    # ────────────── 上傳 / 刪除 / 讀取 ──────────────
    def upload_document(
        self,
        file_path: str,
        original_name: str,
        category: str,
        uploaded_by: str,
        tags: str = "",
        description: str = "",
    ) -> Dict[str, Any]:
        try:
            if not os.path.exists(file_path):
                return {"success": False, "error": "File not found"}

            file_size = os.path.getsize(file_path)
            file_type = Path(file_path).suffix.lower()
            if file_type not in SUPPORTED_EXTENSIONS:
                return {"success": False, "error": f"Unsupported file type: {file_type}"}

            file_hash = self.get_file_hash(file_path)

            with self._connect() as conn:
                exists = conn.execute("SELECT id FROM documents WHERE file_hash=?", (file_hash,)).fetchone()
                if exists:
                    return {"success": False, "error": "Document already exists"}

            content, error = self.extract_text_from_file(file_path, file_type)
            if error and not content:
                return {"success": False, "error": error}

            preview = content[:500] + "..." if len(content) > 500 else content
            if tags:
                tags = ",".join(sorted(set(t.strip().lower() for t in tags.split(",") if t.strip())))

            chunks = self._split_text_into_chunks(content) if content else []
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            safe_name = re.sub(r"[^\w\-_\.]", "_", original_name)
            new_filename = f"{timestamp}_{safe_name}"
            new_file_path = DOCUMENTS_DIR / new_filename

            with self._connect() as conn:
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO documents
                    (filename, original_name, category, file_type, file_size, file_hash,
                     content_preview, uploaded_by, tags, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (new_filename, original_name, category, file_type, file_size,
                      file_hash, preview, uploaded_by, tags, description))
                document_id = cur.lastrowid

                chunk_ids = []
                for i, ck in enumerate(chunks):
                    cur.execute("""
                        INSERT INTO document_chunks (document_id, chunk_index, content, chunk_size)
                        VALUES (?, ?, ?, ?)
                    """, (document_id, i, ck, len(ck)))
                    chunk_ids.append(cur.lastrowid)

                if self.fts_enabled:
                    cur.execute(
                        "INSERT INTO documents_fts(rowid, original_name, tags, description) VALUES (?, ?, ?, ?)",
                        (document_id, original_name, tags or "", description or ""),
                    )
                    for cid, ctext in zip(chunk_ids, chunks):
                        cur.execute(
                            "INSERT INTO chunks_fts(rowid, content, document_id, chunk_id) VALUES (?, ?, ?, ?)",
                            (cid, ctext, document_id, cid),
                        )

            shutil.copy2(file_path, new_file_path)

            return {
                "success": True,
                "document_id": document_id,
                "filename": new_filename,
                "content_length": len(content),
                "chunks_created": len(chunks),
            }
        except Exception as e:
            logger.exception("Error uploading document")
            return {"success": False, "error": str(e)}

    def _split_text_into_chunks(self, text: str) -> List[str]:
        """中英適用切塊"""
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            separators=["\n\n", "\n", ". ", "。", " ", ""],
        )
        return splitter.split_text(text)

    def get_documents(self, category: str = None, status: str = "active") -> List[Dict[str, Any]]:
        with self._connect() as conn:
            q = "SELECT * FROM documents WHERE status=?"
            p = [status]
            if category:
                q += " AND category=?"
                p.append(category)
            q += " ORDER BY upload_date DESC"
            rows = conn.execute(q, p).fetchall()

        docs = []
        for r in rows:
            docs.append({
                "id": r["id"],
                "filename": r["filename"],
                "original_name": r["original_name"],
                "category": r["category"],
                "file_type": r["file_type"],
                "file_size": r["file_size"],
                "content_preview": r["content_preview"],
                "upload_date": r["upload_date"],
                "uploaded_by": r["uploaded_by"],
                "tags": r["tags"],
                "description": r["description"],
            })
        return docs

    def get_document_by_id(self, document_id: int) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            r = conn.execute(
                "SELECT * FROM documents WHERE id=? AND status='active'", (document_id,)
            ).fetchone()
        if not r:
            return None
        return {
            "id": r["id"],
            "filename": r["filename"],
            "original_name": r["original_name"],
            "category": r["category"],
            "file_type": r["file_type"],
            "file_size": r["file_size"],
            "file_hash": r["file_hash"],
            "content_preview": r["content_preview"],
            "upload_date": r["upload_date"],
            "uploaded_by": r["uploaded_by"],
            "tags": r["tags"],
            "description": r["description"],
        }

    def search_documents_by_name(self, search_term: str) -> List[Dict[str, Any]]:
        rows = []
        with self._connect() as conn:
            if self.fts_enabled and search_term.strip():
                try:
                    q = self._fts_safe_query(search_term)
                    # 重要：MATCH / bm25() 使用「表名」，不要用別名
                    rows = conn.execute(f"""
                        SELECT d.*
                        FROM documents_fts
                        JOIN documents d ON d.id = documents_fts.rowid
                        WHERE d.status='active' AND documents_fts MATCH '{q}'
                        ORDER BY bm25(documents_fts)
                        LIMIT 50
                    """).fetchall()
                except Exception as e:
                    logger.warning(f"FTS 文件查詢失敗，使用 LIKE：{e}")
                    rows = []
            if not rows:
                like = f"%{search_term.lower()}%"
                rows = conn.execute("""
                    SELECT * FROM documents
                    WHERE status='active' AND (
                        LOWER(original_name) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(description) LIKE ?
                    )
                    ORDER BY upload_date DESC
                    LIMIT 50
                """, (like, like, like)).fetchall()

        return [{
            "id": r["id"],
            "filename": r["filename"],
            "original_name": r["original_name"],
            "category": r["category"],
            "file_type": r["file_type"],
            "file_size": r["file_size"],
            "upload_date": r["upload_date"],
            "tags": r["tags"],
            "description": r["description"],
        } for r in rows]

    def get_document_path(self, document_id: int) -> Optional[Path]:
        doc = self.get_document_by_id(document_id)
        if doc:
            return DOCUMENTS_DIR / doc["filename"]
        return None

    def delete_document(self, document_id: int) -> bool:
        try:
            with self._connect() as conn:
                r = conn.execute("SELECT filename FROM documents WHERE id=?", (document_id,)).fetchone()
                if not r:
                    return False
                filename = r["filename"]
                conn.execute("DELETE FROM document_chunks WHERE document_id=?", (document_id,))
                conn.execute("DELETE FROM documents WHERE id=?", (document_id,))
                if self.fts_enabled:
                    conn.execute("DELETE FROM documents_fts WHERE rowid=?", (document_id,))
                    conn.execute("DELETE FROM chunks_fts WHERE document_id=?", (document_id,))

            f = DOCUMENTS_DIR / filename
            if f.exists():
                os.remove(f)
            return True
        except Exception as e:
            logger.exception(f"Error deleting document {document_id}")
            return False

    # 取整份文件內容（以 chunk 合併）
    def get_full_text_by_document_id(self, document_id: int) -> str:
        with self._connect() as conn:
            rows = conn.execute("""
                SELECT content FROM document_chunks
                WHERE document_id=?
                ORDER BY chunk_index ASC
            """, (document_id,)).fetchall()
        return "\n".join([r["content"] for r in rows]) if rows else ""

    # 提供給 FTS 清洗（英文加 *，中文保留）
    def _fts_safe_query(self, text: str) -> str:
        toks = re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", text.lower())
        norm = []
        for t in toks:
            if re.match(r"^[a-z0-9]+$", t):
                norm.append(f"{t}*")
            else:
                norm.append(t)
        return " ".join(norm) if norm else text.strip()


# ─────────────────────────── RAG 核心：FAISS + Parent-Child + HyDE + 壓縮 ───────────────────────────
class DocumentRAG:
    """
    - 主 FAISS：以 DB chunks 建 index（MMR）
    - Parent-Child：使用 ParentDocumentRetriever（child：小塊，parent：大段）
    - HyDE：合成假想答案再檢索
    - Contextual Compression：EmbeddingsFilter（可疊 LLMChainExtractor）
    """

    def __init__(self, document_manager: DocumentManager):
        self.dm = document_manager
        self.embedding_model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

        # 主向量庫（chunks）
        self.vectorstore: Optional[FAISS] = None

        # Parent-Child 結構
        self.parent_store = InMemoryStore()   # 僅記憶體（啟動時重建）
        self.pc_vectorstore: Optional[FAISS] = None
        self.parent_splitter = RecursiveCharacterTextSplitter(
            chunk_size=3000, chunk_overlap=200, separators=["\n\n", "\n", ". ", "。", " ", ""]
        )
        self.child_splitter = RecursiveCharacterTextSplitter(
            chunk_size=800, chunk_overlap=120, separators=["\n\n", "\n", ". ", "。", " ", ""]
        )
        self.parent_retriever: Optional[ParentDocumentRetriever] = None

        # 初始化
        self._load_or_build()

    # 建立空的 FAISS（正確維度）供 Parent-Child 使用
    def _new_empty_faiss(self) -> FAISS:
        dim = len(self.embedding_model.embed_query("dimension probe"))
        index = faiss.IndexFlatL2(dim)
        return FAISS(
            embedding_function=self.embedding_model,
            index=index,
            docstore=InMemoryDocstore(),
            index_to_docstore_id={}
        )

    # ───── 主 FAISS ─────
    def _load_or_build(self):
        try:
            faiss_path = INDEX_DIR / "index.faiss"
            if faiss_path.exists():
                self.vectorstore = FAISS.load_local(
                    str(INDEX_DIR), self.embedding_model, allow_dangerous_deserialization=True
                )
                logger.info("✅ 已從磁碟載入主 FAISS")
            else:
                self._build_vector_store()
                self._save()
        except Exception as e:
            logger.error(f"FAISS 載入失敗，改為重建：{e}")
            self._build_vector_store()
            self._save()

        # Parent-Child 結構每次啟動都重建（InMemoryStore）
        try:
            self._build_parent_child_index()
            logger.info("✅ Parent-Child 結構已建立")
        except Exception as e:
            logger.warning(f"⚠️ Parent-Child 建立失敗：{e}")

    def _save(self):
        if self.vectorstore:
            self.vectorstore.save_local(str(INDEX_DIR))
        # parent-child 的 docstore 為記憶體，不做持久化

    def _build_vector_store(self, exclude_doc_ids: Optional[set[int]] = None):
        exclude_doc_ids = exclude_doc_ids or set()
        with self.dm._connect() as conn:
            rows = conn.execute("""
                SELECT dc.id AS chunk_id, dc.content, d.original_name, d.category, d.id AS doc_id, d.tags, d.description
                FROM document_chunks dc
                JOIN documents d ON dc.document_id = d.id
                WHERE d.status='active'
            """).fetchall()

        docs: List[Document] = []
        for r in rows:
            if r["doc_id"] in exclude_doc_ids:
                continue
            docs.append(Document(
                page_content=r["content"],
                metadata={
                    "document_id": r["doc_id"],
                    "chunk_id": r["chunk_id"],
                    "filename": r["original_name"],
                    "category": r["category"],
                    "tags": r["tags"] or "",
                    "description": r["description"] or "",
                },
            ))
        if docs:
            self.vectorstore = FAISS.from_documents(docs, self.embedding_model)
            logger.info(f"✅ 主 FAISS 重建完成，chunks={len(docs)}")
        else:
            self.vectorstore = None
            logger.warning("⚠️ 無可用文件建立主向量庫")

    def rebuild_vector_store(self):
        self._build_vector_store()
        self._save()

    def add_document_chunks(self, document_id: int):
        """增量追加單一檔案 chunks 至主 FAISS，並同步到 Parent-Child"""
        # 主 FAISS
        with self.dm._connect() as conn:
            rows = conn.execute("""
                SELECT dc.id AS chunk_id, dc.content, d.original_name, d.category, d.id AS doc_id, d.tags, d.description
                FROM document_chunks dc
                JOIN documents d ON dc.document_id = d.id
                WHERE d.status='active' AND d.id=?
            """, (document_id,)).fetchall()
        docs = [Document(
            page_content=r["content"],
            metadata={
                "document_id": r["doc_id"],
                "chunk_id": r["chunk_id"],
                "filename": r["original_name"],
                "category": r["category"],
                "tags": r["tags"] or "",
                "description": r["description"] or "",
            },
        ) for r in rows]
        if docs:
            if not self.vectorstore:
                self.vectorstore = FAISS.from_documents(docs, self.embedding_model)
            else:
                self.vectorstore.add_documents(docs)
            self._save()

        # Parent-Child：針對該文件增量加入（不傳 ids，避免長度不一致）
        try:
            self._add_parent_child_for_doc(document_id)
        except Exception as e:
            logger.warning(f"Parent-Child 增量加入失敗（doc={document_id}）：{e}")

    def remove_document(self, document_id: int):
        """FAISS 無法精準刪除 doc，改為重建（排除此 doc）"""
        logger.info(f"🧹 重新建立主向量庫（排除文件 {document_id}）")
        self._build_vector_store(exclude_doc_ids={document_id})
        self._save()

        # Parent-Child：全重建（簡化）
        try:
            self._build_parent_child_index()
        except Exception as e:
            logger.warning(f"Parent-Child 重建失敗：{e}")

    # ───── Parent-Child ─────
    def _build_parent_child_index(self):
        """以 InMemoryStore + 空 FAISS（正確維度）重新建立 Parent-Child 索引"""
        self.parent_store = InMemoryStore()
        self.pc_vectorstore = self._new_empty_faiss()
        self.parent_retriever = ParentDocumentRetriever(
            vectorstore=self.pc_vectorstore,
            docstore=self.parent_store,
            child_splitter=self.child_splitter,
            parent_splitter=self.parent_splitter,
        )

        # 把每一份 document 的全文（由 chunks 合併）當成 parent 加入
        docs = self.dm.get_documents()
        parent_docs: List[Document] = []
        for d in docs:
            full_text = self.dm.get_full_text_by_document_id(d["id"])
            if not full_text.strip():
                continue
            parent_docs.append(Document(
                page_content=full_text,
                metadata={
                    "document_id": d["id"],
                    "filename": d["original_name"],
                    "category": d["category"],
                    "tags": d.get("tags") or "",
                    "description": d.get("description") or "",
                },
            ))
        if parent_docs:
            # 關鍵：不要傳 ids，讓檢索器自行生成，避免「uneven list of documents and ids」
            self.parent_retriever.add_documents(parent_docs)
        logger.info(f"✅ Parent-Child 索引建立完成，parents={len(parent_docs)}")

    def _add_parent_child_for_doc(self, document_id: int):
        """新增單一文件至 Parent-Child（不傳 ids）"""
        if not self.parent_retriever:
            self._build_parent_child_index()
            return
        meta = self.dm.get_document_by_id(document_id)
        if not meta:
            return
        full_text = self.dm.get_full_text_by_document_id(document_id)
        if not full_text.strip():
            return
        pd = Document(
            page_content=full_text,
            metadata={
                "document_id": document_id,
                "filename": meta["original_name"],
                "category": meta["category"],
                "tags": meta.get("tags") or "",
                "description": meta.get("description") or "",
            },
        )
        self.parent_retriever.add_documents([pd])  # 不傳 ids

    # ───── FTS5 候選（安全內插：MATCH/bm25 使用表名） ─────
    def _fts_candidates(self, query: str, limit: int = 30) -> List[sqlite3.Row]:
        if not self.dm.fts_enabled or not query.strip():
            return []
        q = self.dm._fts_safe_query(query)
        try:
            with self.dm._connect() as conn:
                rows = conn.execute(f"""
                    SELECT chunks_fts.rowid AS chunk_rowid,
                           chunks_fts.content,
                           chunks_fts.document_id,
                           chunks_fts.chunk_id,
                           d.original_name,
                           d.category,
                           d.tags,
                           d.description
                    FROM chunks_fts
                    JOIN documents d ON d.id = chunks_fts.document_id
                    WHERE d.status='active'
                      AND chunks_fts MATCH '{q}'
                    ORDER BY bm25(chunks_fts)
                    LIMIT {int(limit)}
                """).fetchall()
            return rows or []
        except Exception as e:
            logger.warning(f"FTS5 查詢失敗，fallback LIKE：{e}")
            like = f"%{query.lower()}%"
            with self.dm._connect() as conn:
                rows = conn.execute("""
                    SELECT dc.id   AS chunk_rowid,
                           dc.content,
                           d.id    AS document_id,
                           dc.id   AS chunk_id,
                           d.original_name,
                           d.category,
                           d.tags,
                           d.description
                    FROM document_chunks dc
                    JOIN documents d ON d.id = dc.document_id
                    WHERE d.status='active'
                      AND (LOWER(dc.content) LIKE ? OR LOWER(d.original_name) LIKE ? OR LOWER(d.tags) LIKE ?)
                    LIMIT ?
                """, (like, like, like, limit)).fetchall()
            return rows or []

    # ───── 壓縮檢索器 ─────
    def _build_compression_retriever(
        self,
        base_retriever,
        use_openai: bool = False,
        openai_model: str = "gpt-4o-mini",
        similarity_threshold: float = 0.3,
    ):
        emb_filter = EmbeddingsFilter(
            embeddings=self.embedding_model,
            similarity_threshold=similarity_threshold,
        )

        base_compressor = emb_filter
        if use_openai and ChatOpenAI and LLMChainExtractor and os.environ.get("OPENAI_API_KEY"):
            try:
                llm = ChatOpenAI(model=openai_model, temperature=0)
                extractor = LLMChainExtractor.from_llm(llm)
                base_compressor = DocumentCompressorPipeline(transformers=[emb_filter, extractor])
            except Exception as e:
                logger.warning(f"LLMChainExtractor 無法建立，改用 EmbeddingsFilter：{e}")
                base_compressor = emb_filter

        return ContextualCompressionRetriever(
            base_compressor=base_compressor,
            base_retriever=base_retriever,
        )

    # ───── HyDE：合成答案再檢索 ─────
    def _hyde_generate(self, question: str, use_openai: bool, openai_model: str) -> str:
        tmpl = (
            "You are a helpful assistant. Create a concise, factual, step-by-step hypothetical answer "
            "to the user's question below. Avoid placeholders. Keep it within 120~180 words.\n\n"
            f"QUESTION:\n{question}\n\nHYPOTHETICAL ANSWER:\n"
        )
        try:
            if use_openai and os.environ.get("OPENAI_API_KEY") and ChatOpenAI:
                llm = ChatOpenAI(model=openai_model, temperature=0.1, max_tokens=220)
                out = llm.invoke(tmpl)
                if hasattr(out, "content"):
                    return str(out.content).strip()
                return str(out).strip()
            # fallback to Ollama
            return ollama_generate(tmpl, model_name=DEFAULT_OLLAMA_MODEL)
        except Exception as e:
            logger.warning(f"HyDE 生成失敗，忽略 HyDE：{e}")
            return ""

    # ───── 查詢主流程 ─────
    def query_documents(
        self,
        question: str,
        k: int = 5,
        use_hyde: bool = True,
        use_parent: bool = True,
        use_compression: bool = True,
        use_openai: bool = False,
        openai_model: str = "gpt-4o-mini",
    ) -> List[Document]:
        if not self.vectorstore:
            return []

        # 1) 主 MMR 檢索
        base_retriever = self.vectorstore.as_retriever(
            search_type="mmr",
            search_kwargs={"k": max(k, 5), "fetch_k": 40, "lambda_mult": 0.5},
        )
        base_docs: List[Document] = base_retriever.invoke(question)

        # 2) FTS 候選（補漏），並合併去重
        def _key(d: Document) -> Tuple:
            return (d.metadata.get("document_id"), d.metadata.get("chunk_id"), d.page_content[:50])

        uniq = { _key(d): d for d in base_docs }

        try:
            fts_rows = self._fts_candidates(question, limit=30)
            for r in fts_rows:
                d = Document(
                    page_content=r["content"],
                    metadata={
                        "document_id": r["document_id"],
                        "chunk_id": r["chunk_id"],
                        "filename": r["original_name"],
                        "category": r["category"],
                        "tags": r["tags"] or "",
                        "description": r["description"] or "",
                    },
                )
                uniq.setdefault(_key(d), d)
        except Exception as e:
            logger.warning(f"FTS 候選合併失敗：{e}")

        # 3) HyDE：合成答案再檢索並合併
        if use_hyde:
            hyde_txt = self._hyde_generate(question, use_openai=use_openai, openai_model=openai_model)
            if hyde_txt:
                try:
                    hyde_docs = base_retriever.invoke(hyde_txt)
                    for d in hyde_docs:
                        uniq.setdefault(_key(d), d)
                except Exception as e:
                    logger.warning(f"HyDE 檢索失敗：{e}")

        # 4) Parent-Child：擷取上位段落（更完整上下文）
        if use_parent and self.parent_retriever:
            try:
                parent_docs = self.parent_retriever.invoke(question)
                for pd in parent_docs:
                    pd.metadata.setdefault("document_id", pd.metadata.get("document_id"))
                    pd.metadata.setdefault("chunk_id", f"parent-{hash(pd.page_content) & 0xffff}")
                    uniq.setdefault(_key(pd), pd)
            except Exception as e:
                logger.warning(f"Parent-Child 檢索失敗：{e}")

        merged = list(uniq.values())

        # 5) Contextual Compression（可選）
        if use_compression:
            try:
                comp = self._build_compression_retriever(
                    base_retriever=base_retriever,
                    use_openai=use_openai,
                    openai_model=openai_model,
                    similarity_threshold=0.30,
                )
                compressed_docs = comp.invoke(question)
                cuniq = { _key(d): d for d in compressed_docs }
                for d in merged:
                    cuniq.setdefault(_key(d), d)
                merged = list(cuniq.values())
            except Exception as e:
                logger.warning(f"Compression 檢索失敗，使用未壓縮結果：{e}")

        # 6) 排序擷取
        merged.sort(key=lambda d: (len(d.page_content), d.metadata.get("category", "")), reverse=True)
        final_docs = merged[:max(k, 8)]
        return final_docs


# ─────────────────────────── 生成模型（Ollama / OpenAI） ───────────────────────────
def _strip_thinking(text: str) -> str:
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    lines = [ln for ln in cleaned.splitlines() if not ln.strip().startswith(("Thinking:", "Processing:", "Analyzing:"))]
    return "\n".join(lines).strip()


def ollama_generate(prompt: str, model_name: str = DEFAULT_OLLAMA_MODEL, stream: bool = False) -> str:
    """本地 Ollama 生成；num_ctx 設 8192、keep_alive 15m"""
    try:
        payload = {
            "model": model_name,
            "prompt": prompt,
            "stream": stream,
            "options": {
                "temperature": 0.2,
                "top_p": 0.1,
                "top_k": 10,
                "repeat_penalty": 1.1,
                "num_predict": 2000,
                "num_ctx": 8192,
            },
            "keep_alive": "15m",
        }
        r = requests.post("http://localhost:11434/api/generate", json=payload, timeout=120)
        r.raise_for_status()
        result = r.json()
        return _strip_thinking(result.get("response", ""))
    except requests.exceptions.RequestException as e:
        raise Exception(f"Ollama 連線錯誤: {str(e)}")
    except Exception as e:
        raise Exception(f"Ollama 回應處理錯誤: {str(e)}")


def openai_generate(prompt: str, model_name: str = "gpt-4o-mini") -> str:
    """OpenAI Chat Completions"""
    try:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise Exception("OpenAI API key not found. Please set OPENAI_API_KEY environment variable.")

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload = {
            "model": model_name,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a helpful assistant specializing in document analysis, SOP guidance, and "
                        "process improvement. Provide clear, actionable responses based on the provided documents."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "max_tokens": 2000,
            "temperature": 0.2,
        }
        r = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=60)
        if r.status_code == 200:
            data = r.json()
            return data["choices"][0]["message"]["content"].strip()
        else:
            detail = r.json().get("error", {}).get("message", r.text)
            raise Exception(f"OpenAI API error: {r.status_code} - {detail}")
    except requests.exceptions.RequestException as e:
        raise Exception(f"Error connecting to OpenAI API: {str(e)}")
    except Exception as e:
        raise Exception(f"Error processing OpenAI request: {str(e)}")


# ─────────────────────────── Prompt 模板 ───────────────────────────
PROMPT_TEMPLATES = {
    "sop_query": PromptTemplate(
        input_variables=["context", "question"],
        template="""Based on the following SOP documents and procedures, please answer the question:

DOCUMENTS:
{context}

QUESTION: {question}

Please provide a clear, step-by-step answer based on the SOP content. If the question involves process improvement, also suggest potential improvements."""
    ),
    "form_assistance": PromptTemplate(
        input_variables=["context", "question"],
        template="""Based on the following forms and templates, please help with the question:

DOCUMENTS:
{context}

QUESTION: {question}

Provide clear guidance on how to fill out or use these forms correctly."""
    ),
    "improvement_analysis": PromptTemplate(
        input_variables=["context", "question"],
        template="""Analyze the following documents for improvement opportunities:

DOCUMENTS:
{context}

QUESTION: {question}

Focus on:
1. Identifying inefficiencies or gaps
2. Suggesting practical improvements
3. Considering cost-effectiveness and feasibility
4. Ensuring compliance and safety"""
    ),
    "document_request": PromptTemplate(
        input_variables=["context", "question", "found_documents"],
        template="""The user is requesting a specific document. Based on the search results:

FOUND DOCUMENTS:
{found_documents}

RELATED CONTEXT:
{context}

USER REQUEST: {question}

Please help identify which document(s) the user needs and provide guidance on accessing them."""
    ),
    "general_document": PromptTemplate(
        input_variables=["context", "question"],
        template="""Based on the following documents, please answer the question:

DOCUMENTS:
{context}

QUESTION: {question}

Provide a comprehensive answer based on the document content."""
    ),
}

# ─────────────────────────── 查詢類型判斷 / 名稱解析 ───────────────────────────
def determine_query_type(question: str) -> tuple[str, bool]:
    q = question.lower()
    doc_req_kw = ['我需要', 'i need', '給我', 'give me', '下載', 'download',
                  '導出', 'export', '找到', 'find', '提供', 'provide',
                  '發送', 'send', '取得', 'get', '要', 'want']
    doc_type_kw = ['文件', '文檔', '表格', '表單', 'form', 'document',
                   'file', 'template', '模板', 'sop', '程序']
    is_doc_req = any(k in q for k in doc_req_kw) and any(k in q for k in doc_type_kw)
    if is_doc_req:
        return "document_request", True

    sop_kw = ['sop', 'procedure', 'process', 'step', 'how to', '流程', '程序', '步驟']
    form_kw = ['form', 'template', 'fill', 'complete', '表格', '填寫', '模板']
    improve_kw = ['improve', 'optimize', 'better', 'enhance', 'suggestion', '改進', '優化', '建議']

    if any(k in q for k in improve_kw):
        return "improvement_analysis", False
    elif any(k in q for k in sop_kw):
        return "sop_query", False
    elif any(k in q for k in form_kw):
        return "form_assistance", False
    else:
        return "general_document", False


def extract_document_name_from_question(question: str) -> str:
    q = question.strip()
    m = re.search(r'["“”](.+?)["“”]', q)
    if m:
        return m.group(1).strip()
    m = re.search(r'[（(](.+?)[)）]', q)
    if m:
        return m.group(1).strip()

    remove_words = ['我需要', '給我', '下載', '導出', '找到', '提供', '發送', '取得', '要',
                    'i need', 'give me', 'download', 'export', 'find', 'provide', 'send', 'get', 'want',
                    '這個', '那個', '的', 'this', 'that', 'the', 'a', 'an']
    lower_q = q.lower()
    for w in remove_words:
        lower_q = lower_q.replace(w, ' ')
    keywords = ['文件', '文檔', '表格', '表單', 'form', 'document', 'file', 'template', '模板',
                'sop', '程序', 'checklist', '清單', 'manual', '手冊', 'policy', '政策']
    for kw in keywords:
        if kw in lower_q:
            parts = lower_q.split(kw, 1)
            if len(parts) > 1 and parts[1].strip():
                return parts[1].strip()
    return " ".join(lower_q.split())


# ─────────────────────────── Orchestrator：AI 文檔分析 ───────────────────────────
class AIDocumentAnalytics:
    def __init__(self):
        self.document_manager = DocumentManager()
        self.rag_system = DocumentRAG(self.document_manager)
        self.prompt_templates = PROMPT_TEMPLATES
        logger.info("✅ AI Document Analytics initialized")

    def upload_document(
        self, file_path: str, original_name: str, category: str,
        uploaded_by: str, tags: str = "", description: str = ""
    ) -> Dict[str, Any]:
        result = self.document_manager.upload_document(
            file_path, original_name, category, uploaded_by, tags, description
        )
        if result.get("success"):
            self.rag_system.add_document_chunks(result["document_id"])
            logger.info(f"✅ Document uploaded & indexes updated: {original_name}")
        return result

    def query_documents(
        self, question: str, use_openai: bool = False, openai_model: str = "gpt-4o-mini"
    ) -> Dict[str, Any]:
        try:
            query_type, is_doc_req = determine_query_type(question)

            # 文件請求優先以名稱搜尋
            if is_doc_req:
                search_term = extract_document_name_from_question(question)
                found = self.document_manager.search_documents_by_name(search_term)
                if found:
                    first = found[0]
                    resp = "✅ 找到了您需要的文檔：\n\n"
                    resp += f"**文檔名稱**: {first['original_name']}\n"
                    resp += f"**類別**: {DOCUMENT_CATEGORIES.get(first['category'], first['category'])}\n"
                    resp += f"**文件類型**: {first['file_type'].upper()}\n"
                    if first.get('description'):
                        resp += f"**描述**: {first['description']}\n"
                    if first.get('tags'):
                        resp += f"**標籤**: {first['tags']}\n"
                    resp += f"\n📥 **下載文檔**: [下載 {first['original_name']}](/api/ai/documents/{first['id']}/download)\n"

                    if len(found) > 1:
                        resp += f"\n📚 還找到其他 {len(found)-1} 個相關文檔：\n"
                        for doc in found[1:4]:
                            resp += f"- [{doc['original_name']}](/api/ai/documents/{doc['id']}/download) ({doc['file_type'].upper()})\n"

                    return {
                        "answer": resp,
                        "source_documents": [{
                            "filename": d['original_name'],
                            "category": d['category'],
                            "document_id": d['id'],
                            "content_preview": f"Document type: {d['file_type'].upper()}",
                        } for d in found[:5]],
                        "status": "success",
                        "ai_provider": "system",
                        "query_type": "document_request",
                        "documents_found": found,
                    }
                else:
                    query_type = "general_document"

            # RAG：MMR + FTS + HyDE + Parent-Child + 壓縮
            relevant = self.rag_system.query_documents(
                question=question,
                k=8,
                use_hyde=True,
                use_parent=True,
                use_compression=True,
                use_openai=use_openai,
                openai_model=openai_model,
            )
            if not relevant:
                return {
                    "answer": "抱歉，找不到相關文檔內容可用於回答。請確認已上傳相關文件，或更換關鍵詞再試。",
                    "source_documents": [],
                    "status": "no_documents",
                }

            # 構建上下文
            context = "\n\n".join([
                f"Document: {d.metadata.get('filename')}\nCategory: {d.metadata.get('category')}\nContent: {d.page_content}"
                for d in relevant
            ])

            tmpl = self.prompt_templates.get(query_type, self.prompt_templates["general_document"])
            prompt = tmpl.format(context=context, question=question) if query_type != "document_request" else tmpl.format(
                context=context, question=question, found_documents=""
            )

            if use_openai:
                answer = openai_generate(prompt, openai_model)
                provider = "openai"
            else:
                answer = ollama_generate(prompt, model_name=DEFAULT_OLLAMA_MODEL)
                provider = "ollama"

            # 回傳來源摘要
            src = [{
                "filename": d.metadata.get("filename"),
                "category": d.metadata.get("category"),
                "document_id": d.metadata.get("document_id"),
                "content_preview": (d.page_content[:200] + "...") if len(d.page_content) > 200 else d.page_content,
            } for d in relevant]

            return {
                "answer": answer,
                "source_documents": src,
                "status": "success",
                "ai_provider": provider,
                "query_type": query_type,
            }
        except Exception as e:
            logger.exception("Query processing error")
            return {"answer": f"處理查詢時出錯: {str(e)}", "source_documents": [], "status": "error"}

    def get_documents(self, category: str = None) -> List[Dict[str, Any]]:
        return self.document_manager.get_documents(category)

    def get_document_by_id(self, document_id: int) -> Optional[Dict[str, Any]]:
        return self.document_manager.get_document_by_id(document_id)

    def get_document_path(self, document_id: int) -> Optional[Path]:
        return self.document_manager.get_document_path(document_id)

    def delete_document(self, document_id: int) -> bool:
        success = self.document_manager.delete_document(document_id)
        if success:
            self.rag_system.remove_document(document_id)
            logger.info(f"✅ Document deleted & indexes rebuilt(excluded): {document_id}")
        return success

    def get_categories(self) -> Dict[str, str]:
        return DOCUMENT_CATEGORIES

    def get_system_status(self) -> Dict[str, Any]:
        try:
            docs = self.document_manager.get_documents()
            with self.document_manager._connect() as conn:
                chunk_count = conn.execute("SELECT COUNT(*) AS c FROM document_chunks").fetchone()["c"]
            faiss_path = INDEX_DIR / "index.faiss"
            index_ready = self.rag_system.vectorstore is not None
            index_size = faiss_path.stat().st_size if faiss_path.exists() else 0

            cat = {}
            for d in docs:
                cat[d["category"]] = cat.get(d["category"], 0) + 1

            return {
                "status": "ready",
                "total_documents": len(docs),
                "total_chunks": int(chunk_count),
                "categories": cat,
                "vector_store_ready": index_ready,
                "vector_store_size_bytes": index_size,
                "supported_file_types": sorted(list(SUPPORTED_EXTENSIONS)),
                "ollama_model": DEFAULT_OLLAMA_MODEL,
                "openai_available": bool(os.environ.get("OPENAI_API_KEY")),
                "fts_enabled": self.document_manager.fts_enabled,
                "parent_child_enabled": self.rag_system.parent_retriever is not None,
            }
        except Exception as e:
            logger.exception("Error getting system status")
            return {"status": "error", "message": str(e)}


# ─────────────────────────── 全局 AI 引擎實例 ───────────────────────────
ai_engine = AIDocumentAnalytics()
