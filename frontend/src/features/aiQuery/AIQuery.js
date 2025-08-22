/* -------------------------------------------------------------------------- */
/*  AIQuery.jsx – 全文（已對齊後端：分頁 / Reindex / RAG 標頭顯示）                */
/* -------------------------------------------------------------------------- */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bot,
  FileText,
  Send,
  Trash2,
  Upload,
  AlertTriangle,
  FileUp,
  Settings,
  Zap,
  Book,
  File,
  X,
  CheckCircle,
  Lightbulb,
  FileCheck,
  Download,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* API Base URL */
const API = process.env.REACT_APP_API_BASE || 'http://localhost:8000';

/* ------------------------- Markdown Renderer ------------------------- */
const MarkdownRenderer = ({ content }) => (
  <div className="prose prose-sm max-w-none text-black">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children, ...props }) => (
          <h1 {...props} className="text-xl font-bold mb-3 text-black">
            {children}
          </h1>
        ),
        h2: ({ children, ...props }) => (
          <h2 {...props} className="text-lg font-semibold mb-2 mt-4 text-black">
            {children}
          </h2>
        ),
        h3: ({ children, ...props }) => (
          <h3 {...props} className="text-md font-semibold mb-2 mt-3 text-black">
            {children}
          </h3>
        ),
        p:  (p) => <p  {...p} className="mb-2 text-black leading-relaxed" />,
        ul: (p) => <ul {...p} className="list-disc list-inside mb-2 space-y-1 text-black" />,
        ol: (p) => <ol {...p} className="list-decimal list-inside mb-2 space-y-1 text-black" />,
        li: (p) => <li {...p} className="text-black" />,
        strong: (p) => <strong {...p} className="font-semibold text-black" />,
        em: (p)   => <em   {...p} className="italic text-black" />,
        code: ({ inline, ...rest }) =>
          inline ? (
            <code {...rest} className="bg-gray-100 px-1 py-0.5 rounded text-sm text-black" />
          ) : (
            <code {...rest} className="block bg-gray-100 p-3 rounded-lg text-sm overflow-x-auto text-black" />
          ),
        blockquote: (p) => (
          <blockquote {...p} className="border-l-4 border-blue-400 pl-4 italic text-black my-2" />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

/* 小元件：旗標 Chip */
const Chip = ({ children, tone = 'gray' }) => {
  const tones = {
    gray: 'bg-gray-100 text-gray-700 border border-gray-200',
    blue: 'bg-blue-100 text-blue-700 border border-blue-200',
    green: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    red: 'bg-rose-100 text-rose-700 border border-rose-200',
    amber: 'bg-amber-100 text-amber-700 border border-amber-200',
    indigo: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
    violet: 'bg-violet-100 text-violet-700 border border-violet-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${tones[tone] || tones.gray}`}>
      {children}
    </span>
  );
};

/* ============================= 主要元件 ============================= */
function AIQuery() {
  /* ---------------------------- State ---------------------------- */
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    status: 'checking',
    total_documents: 0,
    vector_store_ready: false,
    categories: {},
    openai_available: false,
    ollama_model: 'local-llm',
    rag_mode: '',
    hyde: false,
    compression: false,
    parent_feature: false,
  });

  /* Document 管理（含分頁） */
  const [documents, setDocuments] = useState([]);
  const [docsTotal, setDocsTotal] = useState(0);
  const [docsSkip, setDocsSkip] = useState(0);
  const [docsLimit, setDocsLimit] = useState(12);
  const [docLoading, setDocLoading] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadCategory, setUploadCategory] = useState('sop');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploading, setUploading] = useState(false);

  /* UI */
  const [showCommonQueries, setShowCommonQueries] = useState(true);

  /* AI Provider */
  const [useOpenAI, setUseOpenAI] = useState(false);
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini');
  const [showAISettings, setShowAISettings] = useState(false);

  /* RAG Debug（讀取 /query 回傳標頭） */
  const [lastQueryMeta, setLastQueryMeta] = useState({
    provider: '',
    rag_mode: '',
    hyde: false,
    compression: false,
  });

  /* Auth（假資料） */
  const currentUser = { username: 'admin', roles: ['admin'] };
  const isAdmin = currentUser.roles.includes('admin');

  /* -------------------------- 常量 -------------------------- */
  const DOCUMENT_CATEGORIES = {
    sop: 'Standard Operating Procedures',
    form: 'Forms and Templates',
    manual: 'Manuals and Guides',
    policy: 'Policies and Regulations',
    checklist: 'Checklists',
    other: 'Other Documents',
  };

  const commonQueries = {
    sop: {
      name: 'SOP Inquiries',
      icon: <Book className="w-4 h-4" />,
      queries: [
        'How do I perform quality inspection according to SOP?',
        'What are the safety procedures for equipment maintenance?',
      ],
    },
    form: {
      name: 'Form Assistance',
      icon: <FileCheck className="w-4 h-4" />,
      queries: [
        'How do I fill out the quality inspection form?',
        'Where can I find the production log template?',
      ],
    },
  };

  /* --------------------------- API --------------------------- */
  const checkSystemStatus = async () => {
    try {
      const res = await fetch(`${API}/ai/status`);
      const json = await res.json();
      setSystemStatus((prev) => ({ ...prev, ...json }));
    } catch (err) {
      console.error('Status error:', err);
    }
  };

  const fetchDocuments = useCallback(async () => {
    if (!isAdmin) return;
    setDocLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      params.set('skip', String(docsSkip));
      params.set('limit', String(docsLimit));
      const res = await fetch(`${API}/ai/documents?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data || []);
        // 從回應標頭讀取分頁資訊（後端有加 X-Total-Count / X-Skip / X-Limit）
        setDocsTotal(Number(res.headers.get('X-Total-Count') || 0));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDocLoading(false);
    }
  }, [isAdmin, selectedCategory, docsSkip, docsLimit]);

  const handleUploadDocument = async () => {
    if (!uploadFile) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('category', uploadCategory);
    formData.append('tags', uploadTags);
    formData.append('description', uploadDescription);
    try {
      const res = await fetch(`${API}/ai/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      setMessages((p) => [
        ...p,
        { type: 'system', content: `✅ Document uploaded: ${data.filename}`, timestamp: new Date().toLocaleString() },
      ]);
      setUploadFile(null);
      setUploadTags('');
      setUploadDescription('');
      setShowUploadModal(false);
      // 重新載入清單與狀態
      await fetchDocuments();
      await checkSystemStatus();
    } catch (err) {
      setMessages((p) => [
        ...p,
        { type: 'error', content: `Upload failed: ${err.message}`, timestamp: new Date().toLocaleString() },
      ]);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (id, name) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      const res = await fetch(`${API}/ai/documents/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (res.ok) {
        setMessages((p) => [
          ...p,
          { type: 'system', content: `✅ Document deleted: ${name}`, timestamp: new Date().toLocaleString() },
        ]);
        // 若刪除造成當頁無資料，自動往前一頁
        const nextSkip = Math.min(docsSkip, Math.max(0, docsTotal - 1 - ((docsTotal - 1) % docsLimit)));
        setDocsSkip(nextSkip);
        await fetchDocuments();
        await checkSystemStatus();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleReindexAll = async () => {
    if (!window.confirm('Rebuild entire vector store?')) return;
    setDocLoading(true);
    try {
      const res = await fetch(`${API}/ai/reindex`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || data.error || 'Reindex failed');
      setMessages((p) => [
        ...p,
        { type: 'system', content: `🛠 Vector store rebuilt successfully`, timestamp: new Date().toLocaleString() },
      ]);
      await checkSystemStatus();
    } catch (err) {
      setMessages((p) => [
        ...p,
        { type: 'error', content: `Reindex failed: ${err.message}`, timestamp: new Date().toLocaleString() },
      ]);
    } finally {
      setDocLoading(false);
    }
  };

  const handleReindexOne = async (id) => {
    setDocLoading(true);
    try {
      const res = await fetch(`${API}/ai/reindex/${id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || data.error || 'Reindex failed');
      setMessages((p) => [
        ...p,
        { type: 'system', content: `🧩 Document ${id} reindexed`, timestamp: new Date().toLocaleString() },
      ]);
      await checkSystemStatus();
    } catch (err) {
      setMessages((p) => [
        ...p,
        { type: 'error', content: `Reindex doc failed: ${err.message}`, timestamp: new Date().toLocaleString() },
      ]);
    } finally {
      setDocLoading(false);
    }
  };

  const handleDownload = (docId) => {
    const url = `${API}/ai/documents/${docId}/download`;
    // 直接開新視窗下載（保留 token 的情況可改用 a 標籤 + headers 不方便，這裡用新視窗）
    window.open(url, '_blank');
  };

  const testAIProvider = async (provider) => {
    try {
      const res = await fetch(`${API}/ai/test-${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      setMessages((p) => [
        ...p,
        {
          type: 'system',
          content: `🧪 ${provider.toUpperCase()} Test: ${
            data.status === 'connected' || data.success ? '✅ Connected' : '❌ Failed'
          } - ${data.response || data.error}`,
          timestamp: new Date().toLocaleString(),
        },
      ]);
    } catch (err) {
      setMessages((p) => [
        ...p,
        { type: 'error', content: `${provider} test failed: ${err.message}`, timestamp: new Date().toLocaleString() },
      ]);
    }
  };

  const sendQuery = async () => {
    if (!question.trim()) return;
    const userMsg = {
      type: 'user',
      content: question,
      timestamp: new Date().toLocaleString(),
      aiProvider: useOpenAI ? 'OpenAI' : 'Ollama',
      model: useOpenAI ? openaiModel : (systemStatus.ollama_model || 'local-llm'),
    };
    setMessages((p) => [...p, userMsg]);
    setLoading(true);
    setQuestion('');
    try {
      const res = await fetch(`${API}/ai/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({
          question: userMsg.content,
          use_openai: useOpenAI,
          openai_model: openaiModel,
        }),
      });

      // 先取 header 中的 RAG metadata
      const metaProvider = res.headers.get('X-AI-Provider') || '';
      const metaRagMode = res.headers.get('X-RAG-Mode') || '';
      const metaHyde = (res.headers.get('X-RAG-HyDE') || '') === '1';
      const metaCompression = (res.headers.get('X-RAG-Compression') || '') === '1';
      setLastQueryMeta({
        provider: metaProvider,
        rag_mode: metaRagMode,
        hyde: metaHyde,
        compression: metaCompression,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Query failed');

      setMessages((p) => [
        ...p,
        {
          type: 'ai',
          content: data.answer,
          sources: data.source_documents,
          query_type: data.query_type,
          ai_provider: data.ai_provider,
          timestamp: new Date().toLocaleString(),
          meta: { provider: metaProvider, rag_mode: metaRagMode, hyde: metaHyde, compression: metaCompression },
        },
      ]);
    } catch (err) {
      setMessages((p) => [
        ...p,
        { type: 'error', content: `Query failed: ${err.message}`, timestamp: new Date().toLocaleString() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------ Handlers ------------------------ */
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuery();
    }
  };

  const handleQuickQuery = (q) => {
    setQuestion(q);
    if (systemStatus.vector_store_ready) setTimeout(() => document.querySelector('[data-send-button]')?.click(), 100);
  };

  const clearMessages = () => setMessages([]);

  /* -------------------------- Effect -------------------------- */
  useEffect(() => {
    checkSystemStatus();
  }, []);

  useEffect(() => {
    if (isAdmin) fetchDocuments();
  }, [isAdmin, fetchDocuments]);

  // 類別切換時，重置頁碼
  useEffect(() => {
    setDocsSkip(0);
  }, [selectedCategory]);

  // 當 skip/limit 變更且為 admin 時重新載入
  useEffect(() => {
    if (isAdmin) fetchDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsSkip, docsLimit]);

  const totalPages = useMemo(() => (docsLimit > 0 ? Math.ceil(docsTotal / docsLimit) : 1), [docsTotal, docsLimit]);
  const currentPage = useMemo(() => (docsLimit > 0 ? Math.floor(docsSkip / docsLimit) + 1 : 1), [docsSkip, docsLimit]);

  /* ------------------------ Upload Modal ------------------------ */
  const UploadModal = () =>
    showUploadModal && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto text-black">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center space-x-2">
                <FileUp className="w-5 h-5 text-indigo-600" />
                <span>Upload Document</span>
              </h2>
              <button onClick={() => setShowUploadModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* File */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Select File</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-indigo-400">
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  onChange={(e) => setUploadFile(e.target.files[0])}
                  accept=".pdf,.doc,.docx,.txt,.md,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.tiff"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  {uploadFile ? (
                    <div className="space-y-2">
                      <File className="w-12 h-12 text-indigo-600 mx-auto" />
                      <p className="text-sm font-medium">{uploadFile.name}</p>
                      <p className="text-xs">{(uploadFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="w-12 h-12 text-gray-400 mx-auto" />
                      <p className="text-sm">Click to select or drag file (max 50 MB)</p>
                    </div>
                  )}
                </label>
              </div>
            </div>

            {/* Category */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Category</label>
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                className="w-full p-3 border rounded-lg"
              >
                {Object.entries(DOCUMENT_CATEGORIES).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Tags & Desc */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Tags (comma separated)</label>
              <input
                type="text"
                value={uploadTags}
                onChange={(e) => setUploadTags(e.target.value)}
                className="w-full p-3 border rounded-lg"
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                rows={3}
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                className="w-full p-3 border rounded-lg"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowUploadModal(false)} className="px-6 py-2 bg-gray-200 rounded-lg">
                Cancel
              </button>
              <button
                onClick={handleUploadDocument}
                disabled={!uploadFile || uploading}
                className={`px-6 py-2 rounded-lg text-white flex items-center space-x-2 ${
                  !uploadFile || uploading ? 'bg-gray-300' : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>Upload</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );

  /* ---------------------- AI Settings Modal ---------------------- */
  const AISettingsModal = () =>
    showAISettings && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full text-black">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center space-x-2">
                <Settings className="w-5 h-5 text-indigo-600" />
                <span>AI Settings</span>
              </h2>
              <button onClick={() => setShowAISettings(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Provider */}
            <div className="mb-6 space-y-3">
              <label className="block text-sm font-medium">AI Provider</label>
              <label className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input type="radio" name="provider" checked={!useOpenAI} onChange={() => setUseOpenAI(false)} />
                <div className="flex-1">
                  <span className="font-medium">Ollama (Local)</span>
                  <p className="text-xs text-black/60">Free, private</p>
                </div>
                <Chip tone="blue">Free</Chip>
              </label>

              <label
                className={`flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                  !systemStatus.openai_available && 'opacity-50 cursor-not-allowed'
                }`}
              >
                <input
                  type="radio"
                  name="provider"
                  checked={useOpenAI}
                  onChange={() => setUseOpenAI(true)}
                  disabled={!systemStatus.openai_available}
                />
                <div className="flex-1">
                  <span className="font-medium">OpenAI (Cloud)</span>
                  <p className="text-xs text-black/60">Advanced AI</p>
                </div>
                <Chip tone={systemStatus.openai_available ? 'green' : 'red'}>
                  {systemStatus.openai_available ? 'Available' : 'Need API Key'}
                </Chip>
              </label>
            </div>

            {useOpenAI && systemStatus.openai_available && (
              <div className="mb-6">
                <label className="block text-sm font-medium mb-1">OpenAI Model</label>
                <select
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  className="w-full p-3 border rounded-lg"
                >
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                </select>
              </div>
            )}

            {isAdmin && (
              <div className="flex items-center space-x-3 mb-6">
                <button
                  onClick={() => testAIProvider('ollama')}
                  className="flex items-center px-4 py-2 bg-blue-100 text-blue-700 rounded-lg"
                >
                  <Zap className="w-4 h-4 mr-1" />
                  Test Ollama
                </button>
                {systemStatus.openai_available && (
                  <button
                    onClick={() => testAIProvider('openai')}
                    className="flex items-center px-4 py-2 bg-green-100 text-green-700 rounded-lg"
                  >
                    <Zap className="w-4 h-4 mr-1" />
                    Test OpenAI
                  </button>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={() => setShowAISettings(false)} className="px-6 py-2 bg-indigo-600 text-white rounded-lg">
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );

  /* ------------------------ Derived Data ------------------------ */
  const filteredDocuments =
    selectedCategory === 'all' ? documents : documents.filter((d) => d.category === selectedCategory);

  const nextPage = () => {
    if (currentPage < totalPages) setDocsSkip(docsSkip + docsLimit);
  };
  const prevPage = () => {
    if (currentPage > 1) setDocsSkip(Math.max(0, docsSkip - docsLimit));
  };

  /* ----------------------------- 渲染 ----------------------------- */
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4 lg:p-6 text-black">
      <div className="max-w-7xl mx-auto h-full flex flex-col">
        {/* ---------------------- Header ---------------------- */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 border border-blue-100">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
                <Bot className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Document AI Assistant 📚</h1>
                <p className="text-black/70 text-sm">SOP guidance, form assistance, process improvement</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div
                className={`flex items-center space-x-2 px-3 py-2 rounded-full text-sm font-medium ${
                  systemStatus.vector_store_ready
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    systemStatus.vector_store_ready ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
                <span>{systemStatus.total_documents} Docs</span>
              </div>

              {/* 顯示 RAG 設定旗標 */}
              <div className="hidden md:flex items-center gap-2">
                {systemStatus.rag_mode && <Chip tone="indigo">RAG: {String(systemStatus.rag_mode)}</Chip>}
                {systemStatus.parent_feature && <Chip tone="violet">Parent</Chip>}
                {systemStatus.hyde && <Chip tone="blue">HyDE</Chip>}
                {systemStatus.compression && <Chip tone="green">Compression</Chip>}
              </div>

              <button
                onClick={() => setShowAISettings(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                <Settings className="w-4 h-4" />
                <span>AI</span>
              </button>

              {isAdmin && (
                <>
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="flex items-center space-x-2 px-4 py-2 text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-lg shadow-lg"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload</span>
                  </button>
                  <button
                    onClick={handleReindexAll}
                    className="flex items-center space-x-2 px-4 py-2 bg-white border border-indigo-300 hover:bg-indigo-50 rounded-lg"
                    title="Rebuild vector store"
                  >
                    {docLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 text-indigo-600" />}
                    <span className="text-indigo-700">Reindex</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ------------------ Current AI Provider ------------------ */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6 border border-blue-100">
          <div className="flex flex-wrap items-center gap-2">
            <span>Active AI:</span>
            <span className="font-medium">
              {useOpenAI ? `OpenAI ${openaiModel}` : (systemStatus.ollama_model ? `Ollama ${systemStatus.ollama_model}` : 'Ollama')}
            </span>
            {/* 最近一次查詢的實際 RAG 配置（由 /query 標頭回傳） */}
            {lastQueryMeta.rag_mode && <Chip tone="indigo">RAG: {lastQueryMeta.rag_mode}</Chip>}
            {lastQueryMeta.hyde && <Chip tone="blue">HyDE</Chip>}
            {lastQueryMeta.compression && <Chip tone="green">Compression</Chip>}
          </div>
        </div>

        {/* ------------------ Document Library (Admin) ------------------ */}
        {isAdmin && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 border border-blue-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center space-x-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <span>Document Library</span>
              </h3>

              <div className="flex items-center gap-3 text-sm">
                <label className="text-black/70">Per page</label>
                <select
                  value={docsLimit}
                  onChange={(e) => { setDocsLimit(Number(e.target.value)); setDocsSkip(0); }}
                  className="p-2 border rounded-lg"
                >
                  <option value={6}>6</option>
                  <option value={12}>12</option>
                  <option value={24}>24</option>
                  <option value={48}>48</option>
                </select>
              </div>
            </div>

            {/* Category Filter */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-2 rounded-lg text-sm font-medium ${
                  selectedCategory === 'all'
                    ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                All ({Math.min(docsTotal, 9999)})
              </button>
              {Object.entries(DOCUMENT_CATEGORIES).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setSelectedCategory(k)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    selectedCategory === k
                      ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                      : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Documents Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {docLoading && [1,2,3,4,5,6].map((i)=>(
                <div key={i} className="border border-gray-200 rounded-lg p-4 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
                  <div className="h-16 bg-gray-50 rounded mb-3" />
                  <div className="flex justify-between">
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                    <div className="h-6 bg-gray-100 rounded w-16" />
                  </div>
                </div>
              ))}
              {!docLoading && filteredDocuments.map((d) => (
                <div
                  key={d.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 truncate">
                      <h4 className="font-medium text-sm truncate">{d.original_name}</h4>
                      <p className="text-xs text-black/60">{DOCUMENT_CATEGORIES[d.category] || d.category}</p>
                    </div>
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        d.file_type === '.pdf'
                          ? 'bg-red-100 text-red-700'
                          : /doc/.test(d.file_type)
                          ? 'bg-blue-100 text-blue-700'
                          : /xls|csv/.test(d.file_type)
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-black'
                      }`}
                    >
                      {String(d.file_type || '').toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-black/60 mb-3 line-clamp-2">{d.content_preview}</p>
                  {d.tags && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {d.tags.split(',').filter(Boolean).map((t, i) => (
                        <span key={i} className="px-2 py-0.5 bg-gray-100 text-black rounded text-xs">
                          {t.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-black/60">
                    <span>{new Date(d.upload_date).toLocaleDateString()}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleReindexOne(d.id)}
                        className="text-indigo-600 hover:text-indigo-700 p-1"
                        title="Reindex this doc"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDownload(d.id)}
                        className="text-blue-600 hover:text-blue-700 p-1"
                        title="Download"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDeleteDocument(d.id, d.original_name)}
                        className="text-red-600 hover:text-red-700 p-1"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {docsTotal > docsLimit && (
              <div className="flex items-center justify-between mt-6">
                <span className="text-sm text-black/60">
                  Showing <span className="font-medium">{docsSkip + 1}</span>–
                  <span className="font-medium">{Math.min(docsSkip + filteredDocuments.length, docsTotal)}</span> of{' '}
                  <span className="font-medium">{docsTotal}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={prevPage}
                    disabled={currentPage <= 1 || docLoading}
                    className={`px-3 py-2 rounded-lg border ${
                      currentPage <= 1 || docLoading ? 'bg-gray-50 text-black/40' : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    Prev
                  </button>
                  <span className="text-sm">
                    Page <span className="font-medium">{currentPage}</span> / {totalPages}
                  </span>
                  <button
                    onClick={nextPage}
                    disabled={currentPage >= totalPages || docLoading}
                    className={`px-3 py-2 rounded-lg border ${
                      currentPage >= totalPages || docLoading ? 'bg-gray-50 text-black/40' : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ------------------ Common Queries ------------------ */}
        {showCommonQueries && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 border border-blue-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center space-x-2">
                <Lightbulb className="w-5 h-5 text-indigo-600" />
                <span>Common Queries</span>
              </h3>
              <button className="text-black/40 hover:text-black/60" onClick={() => setShowCommonQueries(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(commonQueries).map(([key, cat]) => (
                <div key={key} className="space-y-2">
                  <div className="flex items-center space-x-2 text-sm font-medium">
                    {cat.icon}
                    <span>{cat.name}</span>
                  </div>
                  {cat.queries.map((q, idx) => (
                    <button
                      key={idx}
                      className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-sm"
                      onClick={() => handleQuickQuery(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ------------------ Chat Container ------------------ */}
        <div className="flex-1 bg-white rounded-2xl shadow-lg border border-blue-100 flex flex-col overflow-hidden">
          {/* Messages Area */}
          <div className="flex-1 p-6 overflow-y-auto bg-gradient-to-b from-blue-50/30 to-indigo-50/30 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-12">
                <div className="w-20 h-20 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full mx-auto mb-4 flex items-center justify-center shadow-xl">
                  <Bot className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Welcome to Document AI Assistant!</h3>
                <p className="max-w-md mx-auto text-black/60">
                  Ask questions about SOPs, forms, policies, or request process improvements.
                </p>
              </div>
            )}

            {messages.map((m, idx) => (
              <div key={idx} className="animate-fadeInUp">
                {m.type === 'user' && (
                  <div className="flex justify-end mb-4">
                    <div className="max-w-2xl">
                      <div className="flex items-center justify-end space-x-2 mb-1">
                        <span className="text-xs text-black/60">{m.timestamp}</span>
                        <span className="text-sm font-medium text-indigo-600">You</span>
                      </div>
                      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-2xl rounded-tr-md shadow-lg">
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                    </div>
                  </div>
                )}

                {m.type === 'ai' && (
                  <div className="flex justify-start mb-4">
                    <div className="max-w-4xl">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-emerald-600">AI Assistant</span>
                        <span className="text-xs text-black/60">{m.timestamp}</span>
                        {/* 這次回答的實際執行配置（由 /query 標頭提供） */}
                        {m.meta?.provider && <Chip tone="gray">{m.meta.provider}</Chip>}
                        {m.meta?.rag_mode && <Chip tone="indigo">RAG: {m.meta.rag_mode}</Chip>}
                        {m.meta?.hyde && <Chip tone="blue">HyDE</Chip>}
                        {m.meta?.compression && <Chip tone="green">Compression</Chip>}
                      </div>
                      <div className="bg-white border border-blue-200 p-4 rounded-2xl rounded-tl-md shadow-lg">
                        <MarkdownRenderer content={m.content} />
                        {m.sources?.length > 0 && (
                          <details className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                            <summary className="cursor-pointer flex items-center space-x-2 font-medium">
                              <FileText className="w-4 h-4" />
                              <span>Source Documents</span>
                              <span className="bg-blue-200 text-blue-700 text-xs px-2 py-1 rounded-full">
                                {m.sources.length}
                              </span>
                            </summary>
                            <div className="mt-3 space-y-2">
                              {m.sources.map((s, i) => (
                                <div key={i} className="bg-white p-3 rounded border border-blue-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium text-sm">{s.filename}</span>
                                    <span className="text-xs bg-gray-100 text-black px-2 py-1 rounded">
                                      {s.category}
                                    </span>
                                  </div>
                                  <p className="text-xs text-black/60">{s.content_preview}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {['system', 'error'].includes(m.type) && (
                  <div className="flex justify-center mb-4">
                    <div
                      className={`px-4 py-2 rounded-full flex items-center space-x-2 ${
                        m.type === 'system'
                          ? 'bg-blue-50 border border-blue-200 text-blue-800'
                          : 'bg-red-50 border border-red-200 text-red-800'
                      }`}
                    >
                      {m.type === 'system' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                      <span className="text-sm font-medium">{m.content}</span>
                      <span className="text-xs">{m.timestamp}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start mb-4 animate-fadeInUp">
                <div className="max-w-2xl">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-emerald-600">AI Assistant</span>
                    <span className="text-xs text-black/60">Processing...</span>
                  </div>
                  <div className="bg-white border border-blue-200 p-4 rounded-2xl rounded-tl-md shadow-lg">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" />
                      <div
                        className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                        style={{ animationDelay: '0.1s' }}
                      />
                      <div
                        className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                        style={{ animationDelay: '0.2s' }}
                      />
                      <span className="text-blue-600 text-sm">Analyzing...</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="bg-white border-t border-blue-200 p-6">
            <div className="space-y-4">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter your question… (Enter to send, Shift+Enter for newline)"
                rows={3}
                disabled={
                  loading ||
                  !systemStatus.vector_store_ready ||
                  (useOpenAI && !systemStatus.openai_available)
                }
                className={`w-full p-4 border-2 rounded-xl resize-none ${
                  loading ||
                  !systemStatus.vector_store_ready ||
                  (useOpenAI && !systemStatus.openai_available)
                    ? 'bg-gray-50 border-gray-200 text-black/40'
                    : 'bg-white border-blue-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200'
                }`}
              />

              <div className="flex justify-between items-center">
                <span className="text-xs text-black/60">
                  {question.length} chars • {useOpenAI ? `OpenAI ${openaiModel}` : `Ollama ${systemStatus.ollama_model || ''}`}
                </span>
                <div className="flex space-x-3">
                  <button
                    onClick={clearMessages}
                    disabled={!messages.length}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg ${
                      !messages.length
                        ? 'bg-gray-100 text-black/40 cursor-not-allowed'
                        : 'bg-gray-500 hover:bg-gray-600 text-white'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Clear</span>
                  </button>

                  <button
                    data-send-button
                    onClick={sendQuery}
                    disabled={
                      loading ||
                      !question.trim() ||
                      !systemStatus.vector_store_ready ||
                      (useOpenAI && !systemStatus.openai_available)
                    }
                    className={`flex items-center space-x-2 px-6 py-2 rounded-lg ${
                      loading ||
                      !question.trim() ||
                      !systemStatus.vector_store_ready ||
                      (useOpenAI && !systemStatus.openai_available)
                        ? 'bg-gray-100 text-black/40 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white'
                    }`}
                  >
                    <Send className="w-4 h-4" />
                    <span>{loading ? 'Thinking…' : 'Send'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {UploadModal()}
      {AISettingsModal()}

      {/* Animation */}
      <style jsx>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeInUp { animation: fadeInUp 0.3s ease-out; }
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>
    </div>
  );
}

export default AIQuery;
