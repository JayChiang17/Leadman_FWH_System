# Leadman FWH System Backend

A comprehensive manufacturing management system backend for assembly inventory, quality control, downtime tracking, and production planning.

## 🏗️ System Architecture

```
Leadman FWH System Backend
├── Frontend
│   └── User Interface
├── Backend (FastAPI)
│   ├── API Layer
│   │   ├── Authentication (auth.py)
│   │   ├── User Management (users.py)
│   │   ├── Model Inventory (model.py)
│   │   ├── Assembly Management (assembly.py)
│   │   ├── Downtime Tracking (downtime.py)
│   │   ├── Quality Control (qc.py)
│   │   └── Search Functionality (search.py)
│   ├── Core Layer
│   │   ├── Configuration (config.py)
│   │   ├── Database Connection (db.py)
│   │   ├── Dependency Injection (deps.py, deps_ws.py)
│   │   ├── Security Module (security.py)
│   │   └── WebSocket Manager (ws_manager.py)
│   └── Data Models Layer
│       ├── Assembly Inventory Model (assembly_inventory_model.py)
│       ├── Downtime Model (downtime_model.py)
│       ├── Model Inventory Model (model_inventory_model.py)
│       └── Quality Control Model (qc_model.py)
└── Database
    ├── SQLite Primary Databases
    │   ├── assembly.db
    │   ├── model.db
    │   ├── qc.db
    │   ├── downtime.db
    │   ├── login.db
    │   └── scans.db
    └── Backup Files (.db-shm, .db-wal)
```

## 🔧 Technology Stack

### Backend
- **Framework**: FastAPI
- **Database**: SQLite
- **Authentication**: JWT Token
- **Real-time Communication**: WebSocket
- **Language**: Python 3.x
- **API Documentation**: OpenAPI 3.1 (Swagger)

### Frontend
- Modern frontend framework (specific tech stack depends on frontend folder contents)

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- pip (Python package manager)
- Node.js (if frontend uses Node.js)

### Backend Setup

1. **Create Virtual Environment**
```bash
python -m venv venv
```

2. **Activate Virtual Environment**
```bash
# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate
```

3. **Install Dependencies**
```bash
pip install -r requirements.txt
```

4. **Configure Environment Variables**
```bash
# Copy environment template
cp .env.example .env

# Edit .env file with necessary environment variables
```

5. **Start Backend Server**
```bash
python main.py
```

Backend service will be available at:
- **API**: `http://localhost:8000`
- **API Documentation**: `http://localhost:8000/docs`
- **OpenAPI JSON**: `http://localhost:8000/openapi.json`

### Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

## 📊 Database Schema

The system uses multiple SQLite databases to separate different functional modules:

- **assembly.db**: Assembly inventory data and production records
- **model.db**: Model inventory data and scanning records
- **qc.db**: Quality control check records and test results
- **downtime.db**: Equipment downtime records and analysis
- **login.db**: User authentication and session data
- **scans.db**: All scanning activity logs

## 🔌 API Endpoints

### Authentication & Users
- `GET /api/users/` - Get all users
- `POST /api/users/` - Add new user
- `PUT /api/users/{uid}` - Edit user information
- `DELETE /api/users/{uid}` - Remove user

### Model Inventory Management
- `POST /api/model_inventory` - Scan new model item
- `POST /api/model_inventory/mark_ng` - Mark item as NG (Not Good)
- `POST /api/model_inventory/clear_ng` - Clear NG status
- `GET /api/model_inventory_daily_count` - Get daily production count
- `GET /api/model_inventory_trend` - Get production trend analysis
- `GET /api/weekly_kpi` - Get weekly KPI metrics
- `POST /api/weekly_plan` - Set weekly production plan
- `GET /api/model_inventory/list/all` - List all model records
- `DELETE /api/model_inventory/delete/{scan_id}` - Delete scan record
- `POST /api/model_inventory/update_sn` - Update serial number

### Assembly Management
- `POST /api/assembly_inventory` - Add assembly scan
- `POST /api/assembly_inventory/mark_ng` - Mark assembly as NG
- `POST /api/assembly_inventory/clear_ng` - Clear NG status
- `GET /api/assembly_inventory_daily_count` - Get today's assembly count
- `GET /api/assembly_inventory_trend` - Get assembly trend data
- `GET /api/assembly_weekly_kpi` - Get weekly assembly KPI
- `POST /api/assembly_weekly_plan` - Set assembly weekly plan
- `GET /api/assembly_inventory/export_excel` - Export data to Excel
- `GET /api/assembly_inventory/list/ng` - List NG assemblies
- `GET /api/assembly_inventory/list/all` - List all assemblies
- `DELETE /api/assembly_inventory/delete/{scan_id}` - Delete assembly scan
- `PUT /api/assembly_inventory/{us_sn}` - Update assembly record
- `GET /api/assembly_inventory/{us_sn}` - Get specific assembly

### Downtime Management
- `GET /api/downtime/summary/today` - Today's downtime summary
- `GET /api/downtime/summary/week` - Weekly downtime summary
- `POST /api/downtime` - Add downtime record
- `GET /api/downtime/list` - List all downtime records
- `PUT /api/downtime/{id}` - Update downtime record
- `DELETE /api/downtime/{id}` - Delete downtime record

### Quality Control (QC)
- `GET /api/qc-check/{sn}` - Get QC check by serial number
- `POST /api/qc-check` - Add new QC check
- `GET /api/qc-export` - Export QC data
- `GET /api/qc-dashboard` - QC dashboard metrics
- `GET /api/qc-check/list/all` - List all QC checks
- `DELETE /api/qc-check/delete/{sn}` - Delete QC check

### Search Functionality
- `GET /api/search` - Search across all records

## 🛠️ Development Guide

### Project Structure

```
├── api/                    # API routing layer
│   ├── __pycache__/       # Python cache files
│   ├── __init__.py        # API module initialization
│   ├── assembly_inventory.py  # Assembly management API
│   ├── auth.py            # Authentication API
│   ├── downtime.py        # Downtime tracking API
│   ├── model_inventory.py # Model inventory API
│   ├── qc_check.py        # Quality control API
│   ├── search.py          # Search API
│   ├── users.py           # User management API
│   └── ws_router.py       # WebSocket routing
├── core/                  # Core functionality layer
│   ├── __pycache__/       # Python cache files
│   ├── config.py          # Configuration management
│   ├── db.py              # Database connection
│   ├── deps.py            # Dependency injection
│   ├── deps_ws.py         # WebSocket dependencies
│   ├── security.py        # Security module
│   └── ws_manager.py      # WebSocket manager
├── models/                # Data model layer
│   ├── __pycache__/       # Python cache files
│   ├── assembly_inventory_model.py  # Assembly inventory model
│   ├── downtime_model.py  # Downtime model
│   ├── model_inventory_model.py     # Model inventory model
│   └── qc_model.py        # Quality control model
├── frontend/              # Frontend source code
├── *.db                   # SQLite database files
├── *.db-shm, *.db-wal     # SQLite backup files
├── .env                   # Environment variables
├── credentials.json       # Credentials configuration
├── main.py                # Application entry point
├── requirements.txt       # Python dependencies
└── README.md              # Project documentation
```

### Key Features

#### Production Management
- **Model Inventory Tracking**: Scan-based inventory management with real-time counting
- **Assembly Management**: Complete assembly workflow with quality tracking
- **Weekly Planning**: Set and track weekly production targets
- **KPI Monitoring**: Real-time KPI tracking and trend analysis

#### Quality Control
- **QC Checks**: Comprehensive quality control testing and recording
- **NG Management**: Mark and track Not Good (NG) items
- **QC Dashboard**: Visual analytics for quality metrics
- **Data Export**: Export QC data for reporting

#### Downtime Analysis
- **Real-time Tracking**: Monitor equipment and production downtime
- **Summary Reports**: Daily and weekly downtime summaries
- **Root Cause Analysis**: Track downtime reasons and patterns

#### Data Management
- **Excel Export**: Export production data to Excel format
- **Global Search**: Search across all system records
- **Data Integrity**: Comprehensive data validation and backup

### Adding New Features

1. Define data models in `models/`
2. Create corresponding API routes in `api/`
3. Add necessary core logic in `core/`
4. Update related frontend pages
5. Test with the interactive API docs at `/docs`



## 🔒 Security Features

- JWT Token authentication
- User role-based access control
- Password encryption
- API route permission control
- Data input validation
- Secure session management

## 📝 Environment Variables

```env

# JWT Configuration
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=true

# Production Settings
CORS_ORIGINS=["http://localhost:3000"]
ALLOWED_HOSTS=["localhost", "127.0.0.1"]
```

## 📊 API Documentation

The system provides comprehensive API documentation:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`
- **OpenAPI Schema**: `http://localhost:8000/openapi.json`

