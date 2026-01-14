# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Leadman FWH System - A comprehensive manufacturing management system for PCBA production, assembly inventory, quality control, downtime tracking, and production planning. This is a full-stack application with FastAPI backend and React frontend.

## Development Commands

### Backend (FastAPI)

**Start Development Server:**
```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
# Or with auto-reload (development):
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Install Dependencies:**
```bash
cd backend
pip install -r requirements.txt
```

**API Documentation:**
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- OpenAPI JSON: http://localhost:8000/openapi.json

### Frontend (React)

**Start Development Server:**

*HTTPS Mode (Default - PWA Ready):*
```bash
cd frontend
npm start
# Development server runs on https://192.168.10.100:3000
# Uses self-signed certificate (valid until 2029-01-12)
# PWA installation and Service Workers enabled
```

*HTTP Mode (Fallback):*
```bash
cd frontend
npm run start:http
# Development server runs on http://0.0.0.0:3000
# Use this if HTTPS causes issues during development
```

**Quick Start Scripts:**
```bash
# Windows
.\start-https.bat   # HTTPS mode
.\start-http.bat    # HTTP fallback

# PowerShell
.\start-https.ps1
```

**Build for Production:**
```bash
cd frontend
npm run build
```

**Run Tests:**
```bash
cd frontend
npm test
```

**HTTPS Certificate Setup:**
- Certificate: `frontend/ssl/cert.pem` (self-signed, 3-year validity)
- Private Key: `frontend/ssl/key.pem`
- See `frontend/HTTPS_SETUP_GUIDE.md` for mobile device setup
- Backend remains HTTP - frontend proxies HTTPS → HTTP automatically

## Architecture Overview

### Multi-Database Design

The system uses **multiple SQLite databases** to separate concerns:

- **pcba.db** - PCBA (Printed Circuit Board Assembly) tracking, board stages (aging/coating/completed), NG flags
- **assembly.db** - Assembly production scans (AM7/AU8 pairs), assembly inventory
- **model.db** - Model inventory and production scanning records
- **login.db** - User authentication, sessions, refresh tokens, login audit logs
- **downtime.db** - Equipment downtime records and analysis
- **module_equipment.db** - Module equipment production data
- **documents.db** - AI document analytics with FAISS vector search and FTS5

**CRITICAL**: Database files are located at the **project root** (Desktop/), NOT inside backend/. Always use absolute paths or proper path resolution when connecting to databases.

### Backend Architecture (FastAPI)

**Layer Structure:**
```
api/          - API route handlers (15 modules)
├── pcba.py           - PCBA tracking (11,288+ boards)
├── assembly_inventory.py
├── model_inventory.py
├── auth.py           - JWT authentication
├── users.py
├── qc_check.py       - Quality control
├── downtime.py
├── ws_router.py      - WebSocket real-time updates
├── ai_routes.py      - Document search with RAG
└── ...

core/         - Core utilities (12 modules)
├── db.py             - Database connection pools
├── security.py       - JWT, password hashing
├── deps.py           - FastAPI dependencies
├── deps_ws.py        - WebSocket auth
├── ws_manager.py     - WebSocket connection manager
├── cache_utils.py    - In-memory caching (TTL-based)
├── scheduler.py      - APScheduler for daily reports
└── ...

services/     - Business logic services (4 modules)
├── ai_service.py     - FAISS vector search + FTS5
├── email_service.py  - Microsoft Graph API emails
├── data_collection_service.py
└── daily_report_service.py
```

**Key Patterns:**

1. **Database Access**: Use `open_conn()` functions defined in each API module (e.g., `open_pcba_conn()` in `api/pcba.py`). These use absolute path resolution via `pathlib`.

2. **Caching**: `core/cache_utils.py` provides TTL-based in-memory cache. Use `CACHE.get(key)` and `CACHE.set(key, value, ttl)`.

3. **WebSocket Broadcasting**: `ws_manager.broadcast(message)` sends to all connected clients. Auth via query param token: `/ws/pcba?token=...`

4. **Authentication**: JWT tokens (15min access, 7 day refresh). Admin password is `0000`. Use `Depends(get_current_user)` for protected routes.

### Frontend Architecture (React 19 + Tailwind)

**Feature-Based Structure:**
```
src/
├── features/           - Feature modules (14 modules)
│   ├── pcbaTracking/      - PCBA production tracking
│   ├── assemblyProduction/
│   ├── dashboard/
│   ├── qcCheck/
│   ├── downtime/
│   ├── aiQuery/           - AI document search
│   └── ...
├── components/         - Shared UI components
├── utils/             - Utilities and hooks
│   ├── usePCBAWebSocket.js  - WebSocket hook
│   └── ...
└── App.js
```

**WebSocket Integration:**
- Custom hook: `usePCBAWebSocket(onMessage)` in `utils/usePCBAWebSocket.js`
- Auto-reconnect with exponential backoff
- Authentication via JWT token in query param
- Message types: `initial_data`, `board_update`, `statistics_update`, `notification`

**Proxy Configuration:**
- `src/setupProxy.js` proxies `/api` requests to backend (http://192.168.10.100:8000)
- `src/setupProxy.js` proxies `/ws` WebSocket connections (wss:// → ws://)
- HTTPS frontend automatically proxies to HTTP backend
- WebSocket auto-upgrades: https:// → wss:// → ws:// (backend)

## Critical Performance Issues & Fixes

### PCBA WebSocket Performance

**Problem**: Sending all 11,288 boards via WebSocket causes connection timeouts.

**Solution** (already implemented in `api/ws_router.py:191`):
```python
# DON'T send all boards - frontend loads via REST API
await safe_send_json(ws, {
    "type": "initial_data",
    "boards": [],  # Empty! Frontend pagination via REST
    "statistics": payload
})
```

### PCBA Statistics Query

**Problem**: LEFT JOIN with assembly.db creates Cartesian product (11,288 × 9,546 = 107M comparisons).

**Solution** (implemented in `api/pcba.py:845-928`):
```python
# Fast GROUP BY without consumed filtering
query = """
    SELECT model, stage, ng_flag, COUNT(*) as cnt
    FROM boards
    GROUP BY model, stage, ng_flag
"""
# Query time: ~10ms (was: timeout)
```

**NEVER filter consumed boards in statistics query** - do it separately in `_assembly_usage_counts_limited_to_pcba()`.

### API Pagination Limits

- `/api/pcba/boards`: max limit=1000
- `/api/pcba/ng/active`: max limit=5000 (NG boards are fewer)
- Frontend requests honor these limits

## Database Schema Essentials

### PCBA Boards Table
```sql
CREATE TABLE boards (
    serial_number TEXT PRIMARY KEY,
    model TEXT,  -- 'AM7' or 'AU8'
    stage TEXT,  -- 'aging', 'coating', 'completed'
    ng_flag INTEGER,  -- 0=OK, 1=NG
    batch_number TEXT,
    operator TEXT,
    created_at TEXT,
    updated_at TEXT
);
```

### Assembly Scans Table
```sql
-- assembly.db
CREATE TABLE scans (
    us_sn TEXT PRIMARY KEY,  -- Assembly serial number
    am7 TEXT,  -- AM7 board serial (normalized)
    au8 TEXT,  -- AU8 board serial (normalized)
    operator TEXT,
    timestamp TEXT
);
```

**Serial Number Normalization**: Remove `-` and spaces, uppercase. Critical for JOIN operations between pcba.db and assembly.db.

## Environment Configuration

**Required .env variables** (backend/.env):
```bash
# Auth
SECRET_KEY=your-secret-key-here
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
DB_PATH=./login.db

# Microsoft Graph API (for email reports)
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
SENDER_EMAIL=jay.chiang@leadman.com

# Daily Reports
REPORT_SEND_TIME=18:00
DAILY_REPORT_EMAILS=jay.chiang@leadman.com
```

**Default Admin Credentials:**
- Username: `admin`
- Password: `0000`

## Common Development Patterns

### Adding a New API Endpoint

1. Define route in `api/` module (e.g., `api/pcba.py`)
2. Use `Depends(get_current_user)` for auth
3. Open database connection with module-specific `open_conn()` function
4. Return Pydantic model (auto-validates and documents)
5. Add caching if read-heavy: `CACHE.get()` / `CACHE.set()`
6. For writes: broadcast via `ws_manager.broadcast()` if real-time updates needed

### Adding WebSocket Message Type

1. Add handler in `api/ws_router.py` → `handle_pcba_message_safe()`
2. Update frontend `PCBATracking.js` → `onWSMessage()` switch statement
3. Use `safe_send_json()` and `safe_send_text()` wrappers (5s timeout protection)

### Database Connection Pool

Use `contextlib.contextmanager` pattern:
```python
@contextmanager
def get_connection():
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

## Known Issues & Gotchas

1. **Windows UTF-8**: `main.py` wraps stdout/stderr for UTF-8 emoji/Chinese support
2. **WAL Mode**: All databases use WAL (Write-Ahead Logging) for concurrent access
3. **CORS**: Backend allows all origins (`allow_origins=["*"]`) - restrict in production
4. **Token Expiry**: Access tokens expire in 15min, use refresh token flow
5. **WebSocket Reconnect**: Frontend automatically reconnects with exponential backoff
6. **Proxy Warnings**: Hot-reload `.hot-update.json` proxy errors in frontend dev server are harmless
7. **Database Location**: Always at project root, not backend/ subdirectory
8. **Serial Normalization**: Always normalize serials before DB queries (remove `-`, spaces, uppercase)

## Testing Notes

- Backend has no automated tests currently (use `/docs` for manual API testing)
- Frontend uses React Testing Library (run with `npm test`)
- Key test file: `frontend/src/utils/usePCBAWebSocket.test.js` (WebSocket hook)

## PWA & HTTPS Setup

### Local Development HTTPS

The frontend is configured for HTTPS development to enable PWA installation and Service Workers:

**Certificate Details:**
- Location: `frontend/ssl/`
- Files:
  - `rootCA.crt` + `rootCA.key` - Root CA certificate (expires 2028-04-17)
  - `cert.pem` - Server certificate signed by rootCA (expires 2028-04-17)
  - `key.pem` - Server private key
  - `cert.crt` - Same as cert.pem in .crt format for Android
- Certificate Chain: rootCA → cert.pem (proper CA hierarchy)
- CN: 192.168.10.100 (server cert) / Local Dev Root CA (root cert)

**Architecture:**
```
Mobile/Desktop Browser
    ↓ HTTPS (https://192.168.10.100:3000)
React Dev Server (HTTPS)
    ↓ HTTP Proxy (setupProxy.js)
FastAPI Backend (HTTP :8000)
```

**CRITICAL Configuration:**

Frontend `.env` **MUST** use relative path for API requests to work with HTTPS:
```bash
# ✅ CORRECT - Uses setupProxy.js to proxy HTTPS → HTTP
REACT_APP_API_BASE=/api

# ❌ WRONG - Causes Mixed Content error in browsers (HTTPS → HTTP blocked)
# REACT_APP_API_BASE=http://192.168.10.100:8000/api
```

**How it works:**
1. Frontend code makes request to `/api/auth/token`
2. setupProxy.js intercepts and proxies to `http://192.168.10.100:8000/api/auth/token`
3. Browser sees HTTPS → HTTPS, backend receives HTTP (no Mixed Content error)

**Key Features:**
- ✅ Self-signed certificate for local development
- ✅ Backend remains HTTP (no configuration needed)
- ✅ setupProxy.js handles HTTPS → HTTP proxy
- ✅ WebSocket auto-upgrades: wss:// → ws://
- ✅ PWA installation enabled
- ✅ Service Workers functional

**Certificate Trust Setup (CRITICAL for PWA):**

**Important**: Simply clicking "Proceed" on certificate warnings in Chrome is NOT enough for PWA installation. Service Workers require **fully trusted certificates** installed to the system's Root CA store.

**Windows (Local Development Machine):**

**CRITICAL**: You must install `rootCA.crt` (NOT cert.pem) to Windows **Local Machine** Root store:

*Method 1 - Automated Script (Recommended):*
1. Right-click `frontend/ssl/INSTALL_ROOT_CA_ADMIN.bat`
2. Select "Run as Administrator"
3. Click "Yes" on UAC prompt
4. Verify success message
5. **Completely close Chrome** (End all chrome.exe processes in Task Manager)
6. Restart Chrome and test

*Method 2 - Manual (GUI):*
1. Double-click `frontend/ssl/rootCA.crt`
2. Click "Install Certificate..."
3. Store Location: **"Local Machine"** (NOT "Current User") ← CRITICAL
4. Click UAC "Yes"
5. Certificate Store: **"Trusted Root Certification Authorities"**
6. Complete installation
7. Restart Chrome

*Method 3 - Command Line:*
```powershell
# Run PowerShell as Administrator
certutil -addstore "Root" "C:\Users\admin\Desktop\frontend\ssl\rootCA.crt"
```

*Verify Installation:*
```powershell
certutil -store Root | Select-String "Local Dev Root CA"
```

*Common Mistake:*
❌ Installing with `certutil -user -addstore` (installs to user store, Chrome can't see it)
✅ Installing with `certutil -addstore` as admin (installs to Local Machine store)

See detailed guide: `frontend/ssl/INSTALL_CERT_WINDOWS_MANUAL.md`

**Android:**

Install `rootCA.crt` (NOT cert.crt) to system CA certificates:

1. Transfer `frontend/ssl/rootCA.crt` to device via WeChat/Email/USB
2. Settings > Security > Encryption & credentials > **Install a certificate** > **CA certificate** (NOT "VPN & app user certificate")
3. Click "Install anyway" (ignore warning)
4. Select rootCA.crt file and enter screen lock password
5. Verify: Settings > Security > Trusted credentials > User tab > Should see "Local Dev Root CA"
6. Test: Chrome address bar should show 🔒 lock icon WITHOUT warnings
7. Detailed guide: `frontend/INSTALL_CERTIFICATE_ANDROID.md`

**iOS:**

1. AirDrop `rootCA.crt` to iPhone
2. Settings > General > VPN & Device Management > Install Profile
3. Settings > General > About > Certificate Trust Settings > Enable full trust for "Local Dev Root CA"
4. Verify: Safari should show lock icon without warnings

**Regenerating Certificate (when expired):**

**Important**: Use the provided PowerShell scripts to maintain proper CA hierarchy:

*Option 1 - Re-sign existing server cert (Quick):*
```powershell
cd frontend/ssl
$ossl = "C:\Program Files\OpenSSL-Win64\bin\openssl.exe"
# Re-sign cert.pem with rootCA for another 825 days
& $ossl x509 -req -in csr.pem -CA rootCA.crt -CAkey rootCA.key -CAcreateserial -out cert.pem -days 825 -sha256 -extfile server_ext.cnf
# Verify
& $ossl x509 -in cert.pem -noout -issuer -subject -dates
```

*Option 2 - Generate new Root CA and server cert (Full reset):*
```powershell
cd frontend/ssl
# See the full generation script in previous PowerShell history
# This regenerates both rootCA and server cert with proper extensions
```

After regenerating, **must re-install rootCA.crt** to all devices (Windows, Android, iOS)

**Troubleshooting:**

- **Browser shows "Not Secure" or certificate warning**:
  - Root CA not installed to system, or installed to wrong store (User vs Local Machine)
  - Fix: Install `rootCA.crt` to Local Machine Root store (see guides above)

- **Service Worker fails with "SSL certificate error"**:
  - Certificate chain not trusted by system
  - Fix Windows: Install `rootCA.crt` to **Local Machine** Root store (NOT User store)
  - Fix Android: Install `rootCA.crt` as **CA certificate** (NOT VPN & app user certificate)

- **Chrome shows issuer=CN=192.168.10.100 instead of issuer=CN=Local Dev Root CA**:
  - React dev server is using old certificate
  - Fix: Stop dev server (kill port 3000 process) and restart with `npm start`

- **Install Prompt test fails but other 3 tests pass**:
  - This is normal! PWA may already be installed or Chrome requires user engagement
  - Try: Chrome menu → "Install Leadman FWH System..." or clear site data
  - Check: Visit `/check-installed.html` to see if PWA is already installed

- **Dashboard not loading / blank screen**:
  - CRITICAL: Dashboard.js uses relative paths without leading "/"
  - Correct: `api.get("model_inventory_daily_count")` ✅
  - Wrong: `api.get("/model_inventory_daily_count")` ❌ (interceptor strips the "/")
  - Fix: Ensure all API calls in Dashboard use relative paths
  - Restart dev server after changes: Stop port 3000 process, run `npm start`

- **WebSocket fails**:
  - Ensure `/ws` proxy in setupProxy.js has `ws: true`

- **Mobile can't connect**:
  - Check Windows Firewall allows inbound connections on port 3000

- **Certificate verification with OpenSSL shows "unable to verify"**:
  - This is expected! OpenSSL doesn't use Windows certificate store
  - Chrome/Edge **do** use Windows store, so they will trust the certificate if rootCA is installed

**Quick Diagnosis:**

*Desktop Chrome:*
1. Visit `https://192.168.10.100:3000/pwa-test.html`
2. Expected results:
   ```
   ✅ HTTPS Protocol: PASS
   ✅ Manifest File: PASS
   ✅ Service Worker: PASS  ← Most critical!
   ✅/❌ Install Prompt: May fail if already installed (OK)
   ```
3. Address bar should show 🔒 (lock icon, no warning)
4. Click lock → Certificate should show issuer "Local Dev Root CA"

*Mobile Chrome:*
- Same test page - if Service Worker fails, `rootCA.crt` not properly installed to CA certificates

*Check if PWA is installed:*
- Visit `https://192.168.10.100:3000/check-installed.html`
- Shows installation status and provides manual install button

See detailed guides:
- `frontend/QUICK_FIX_GUIDE.md` - Fast 3-step fix
- `frontend/INSTALL_CERTIFICATE_ANDROID.md` - Complete Android guide
- `frontend/HTTPS_SETUP_GUIDE.md` - General HTTPS setup
- `frontend/PWA_INSTALL_GUIDE.md` - PWA installation troubleshooting

## Production Deployment Checklist

1. Set strong `SECRET_KEY` in .env
2. Configure `CORS_ORIGINS` to specific domains
3. Use production WSGI server (not uvicorn directly)
4. Set up SQLite backups (WAL mode creates .db-shm, .db-wal files)
5. Configure firewall for port 8000 (backend) and 3000 (frontend)
6. Enable Microsoft Graph API credentials for email reports
7. Build frontend: `npm run build` and serve static files
8. Monitor APScheduler for daily report execution

## AI Document Search (RAG System)

Located in `services/ai_service.py` and `api/ai_routes.py`:

- **Vector Search**: FAISS with sentence-transformers (all-MiniLM-L6-v2)
- **Full-Text Search**: SQLite FTS5 for keyword matching
- **Hybrid Strategy**: Combines vector similarity + FTS5 results
- **Parent-Child Indexing**: Documents split into chunks with parent references
- **Storage**: documents.db (SQLite) + FAISS index files

## Module Equipment Data Collection

`services/data_collection_service.py` handles production data from external equipment:
- Pools database connections for performance
- Batch inserts with transaction safety
- Time format validation with detailed error messages
- Used by `api/module_equipment.py` endpoint

## ATE Testing - NG Management

Located in `api/ate_testing.py` (backend) and `features/ateTesting/` (frontend):

**Purpose**: Dedicated interface for ATE (Automated Test Equipment) operators to manage NG (Not Good) status for assembly records.

**Key Features**:
- Scan serial numbers to verify records exist in assembly database
- Mark assemblies as NG with manual reason input
- Clear NG status (mark as FIXED)
- Real-time statistics display (NG count, fixed count, pass rate)
- Recent NG records list with WebSocket live updates
- Mobile-first responsive design optimized for handheld devices

**Backend Endpoints** (`/api/ate`):
```
GET  /ate/stats              - Today's NG statistics
GET  /ate/scan/{us_sn}       - Verify SN exists in assembly DB
POST /ate/mark_ng            - Mark record as NG with reason
POST /ate/clear_ng           - Clear NG status (mark as FIXED)
GET  /ate/recent?limit=50    - Recent NG records (default 50)
```

**WebSocket Integration**:
- Broadcasts `assembly_status_updated` events on NG status changes
- Frontend auto-refreshes stats and recent list on WebSocket updates

**RWD Breakpoints**:
- Mobile (<768px): Vertical single-column layout, full-width buttons (py-6)
- Tablet (768px-1024px): Two-column layout, side-by-side buttons (py-5)
- Desktop (>1024px): Multi-column layout, search in stats row (py-4)

## UI/UX Design Constraints

These design rules ensure consistency across all features in the Leadman FWH System:

### ❌ Prohibited Styles

1. **NO Purple Colors**
   - Purple (`purple-*`, `violet-*`, `fuchsia-*`) is not used in this system
   - Allowed colors: Gray/Stone, Teal, Emerald, Cyan, Amber, Red (for errors/NG)

2. **NO Fully Rounded Corners**
   - Avoid: `rounded-full`, `rounded-3xl`, `rounded-2xl`
   - Use: `rounded-md` (0.375rem), `rounded-lg` (0.5rem), `rounded-xl` (0.75rem max)
   - Exception: Small decorative elements like status badges or avatars

3. **Minimal Hover Effects**
   - Avoid: Scale transforms (`hover:scale-*`), excessive shadows, dramatic color shifts
   - Use: Subtle background changes (`hover:bg-gray-50`), border color changes (`hover:border-teal-500`)
   - Keep transitions simple: `transition-colors`, `duration-150` or `duration-200`

### ✅ Approved Design Patterns

**Colors**:
- **Primary**: Teal/Cyan (`teal-600`, `cyan-600`) for primary actions
- **Success**: Emerald (`emerald-600`) for positive actions (e.g., "Clean NG", "Fixed")
- **Warning**: Amber (`amber-600`) for warnings or NG counts
- **Error/NG**: Red (`red-600`) for errors or NG status
- **Neutral**: Stone/Gray (`stone-300`, `gray-50`) for borders, backgrounds

**Typography**:
- Font: Inter (already configured in Tailwind)
- Headings: `font-semibold` or `font-bold`, clear size hierarchy
- Labels: `text-sm`, `uppercase`, `tracking-wide`, `font-semibold`
- Body text: `text-base` (mobile: `text-lg` for input fields)

**Spacing**:
- Consistent padding: `p-3`, `p-4`, `p-5`, `p-6`
- Consistent gaps: `gap-2`, `gap-3`, `gap-4`
- Margin: Use sparingly, prefer `space-y-*` for vertical stacking

**Buttons**:
- Shape: Rectangular with `rounded-lg` or `rounded-xl`
- Size: Minimum 44x44px touch targets on mobile, 48px for primary actions
- States: Clear disabled state (`disabled:opacity-50 disabled:cursor-not-allowed`)
- Feedback: `active:scale-95` for touch feedback

**Borders**:
- Default: `border border-gray-200` or `border-stone-300`
- Focus: `focus:border-teal-500 focus:ring-2 focus:ring-teal-500`
- Thickness: Mostly `border` (1px), use `border-2` for emphasis

**Shadows**:
- Light: `shadow-sm` for cards
- Medium: `shadow-md` or `shadow-lg` for elevated elements
- Heavy: `shadow-xl` or `shadow-2xl` for modals or popovers

**Inputs & Forms**:
- Background: `bg-white` or `bg-stone-50`
- Border: `border-2 border-stone-300`
- Focus: `focus:ring-2 focus:ring-teal-500 focus:border-teal-500`
- Mobile: `font-size: 16px` to prevent iOS auto-zoom

**Cards**:
- Background: `bg-white`
- Border: `border border-stone-200`
- Rounding: `rounded-lg` or `rounded-xl`
- Shadow: `shadow-sm`

### 📱 Mobile-First RWD Requirements

1. **Touch Optimization**
   - All clickable elements must be at least 44x44px
   - Use `touch-action: manipulation` to prevent double-tap zoom
   - Use `-webkit-tap-highlight-color: transparent` to remove tap highlight

2. **Responsive Typography**
   - Mobile: Larger font sizes (`text-lg`, `text-xl`) for readability
   - Desktop: Standard sizes (`text-base`)

3. **Responsive Layout**
   - Mobile: Single-column, vertical stacking
   - Tablet: Two-column grid where appropriate
   - Desktop: Multi-column with better space utilization

4. **Fixed Headers**
   - Use `sticky top-0` for headers on mobile
   - Add `z-40` or higher to ensure proper stacking

5. **Bottom Safe Area**
   - Add `pb-20 md:pb-8` to account for mobile bottom navigation/gestures

### 🎨 Example Component (Button)

```jsx
{/* Correct: Teal primary button with proper sizing and feedback */}
<button
  onClick={handleSubmit}
  disabled={loading}
  className="w-full md:w-auto px-6 py-4 md:py-3
             bg-teal-600 hover:bg-teal-700 active:bg-teal-800
             text-white font-bold text-base rounded-lg
             transition-colors duration-150
             disabled:opacity-50 disabled:cursor-not-allowed
             shadow-lg active:scale-95"
>
  Submit
</button>

{/* Incorrect: Purple button with excessive effects */}
<button
  className="px-4 py-2 bg-purple-600 hover:bg-purple-700
             hover:scale-105 rounded-full shadow-2xl
             transform transition-all duration-500"
>
  Submit
</button>
```

### 📋 Design Checklist

Before committing new UI components:

- [ ] No purple/violet/fuchsia colors used
- [ ] Border radius ≤ `rounded-xl` (except small decorative elements)
- [ ] Hover effects are subtle (color/background changes only)
- [ ] Touch targets ≥ 44x44px on mobile
- [ ] Responsive design tested on mobile, tablet, desktop
- [ ] Consistent spacing (p-3/4/5/6, gap-2/3/4)
- [ ] Proper focus states on all interactive elements
- [ ] Disabled states clearly visible
- [ ] Font sizes appropriate for device (larger on mobile)
