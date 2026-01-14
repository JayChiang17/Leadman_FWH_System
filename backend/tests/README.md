# 後端優化單元測試

## 📋 測試文件

| 測試文件 | 測試內容 | 覆蓋問題 |
|----------|----------|----------|
| `test_data_collection_service.py` | 數據庫連接池、錯誤處理 | #1, #4 |
| `test_scheduler.py` | Scheduler 動態重載 | #2 |
| `test_rate_limiter.py` | API 速率限制 | #6 |
| `test_email_pagination.py` | 收件人分頁 | #7 |

---

## 🚀 運行測試

### 運行所有測試

```bash
cd C:\Users\admin\Desktop\backend
python tests\run_all_tests.py
```

### 運行單個測試文件

```bash
# 數據庫連接池測試
python -m unittest tests.test_data_collection_service

# Scheduler 測試
python -m unittest tests.test_scheduler

# 速率限制測試
python -m unittest tests.test_rate_limiter

# 分頁測試
python -m unittest tests.test_email_pagination
```

### 運行特定測試

```bash
# 只測試連接池
python -m unittest tests.test_data_collection_service.TestDataCollectionService.test_connection_pool_creation

# 只測試速率限制
python -m unittest tests.test_rate_limiter.TestRateLimiter.test_rate_limit_enforced
```

---

## 📊 預期結果

### 成功輸出示例

```
test_connection_pool_creation (__main__.TestDataCollectionService) ... ok
test_connection_reuse (__main__.TestDataCollectionService) ... ok
test_wal_mode_enabled (__main__.TestDataCollectionService) ... ok
...
----------------------------------------------------------------------
Ran 28 tests in 2.345s

OK

======================================================================
TEST SUMMARY
======================================================================
Tests run: 28
Failures: 0
Errors: 0
Skipped: 0

✅ ALL TESTS PASSED!
```

---

## 🔧 測試覆蓋詳情

### 問題 #1: 數據庫連接池
- ✅ 連接池創建
- ✅ 連接復用
- ✅ WAL 模式啟用
- ✅ 數據庫鎖定重試
- ✅ 安全關閉
- ✅ 無效類型處理

### 問題 #2: Scheduler 動態重載
- ✅ 初始化
- ✅ 配置更新
- ✅ Job 移除
- ✅ Disabled 處理
- ✅ 無收件人處理
- ✅ Next run time

### 問題 #4: 錯誤處理
- ✅ Safe fetchone
- ✅ JSON 解碼錯誤

### 問題 #6: API 速率限制
- ✅ 首次請求
- ✅ 速率執行
- ✅ 窗口重置
- ✅ Key 獨立性
- ✅ Reset 功能
- ✅ 線程安全

### 問題 #7: 收件人分頁
- ✅ 基本分頁
- ✅ 多頁處理
- ✅ 最後一頁
- ✅ 空結果
- ✅ 自定義參數
- ✅ 預設值

---

## ⚠️ 注意事項

1. **臨時數據庫**: 所有測試使用臨時數據庫，不會影響生產數據
2. **時間相關測試**: 某些測試可能需要等待（如速率限制窗口重置）
3. **並發測試**: 線程安全測試可能在不同環境有差異

---

## 🐛 故障排除

### 測試失敗

如果測試失敗，請檢查：

1. **Python 版本**: 需要 Python 3.9+
2. **依賴安裝**: 確保所有依賴已安裝
3. **路徑問題**: 確保在 backend 目錄運行
4. **數據庫鎖定**: 確保沒有其他進程占用測試數據庫

### 常見錯誤

```bash
# ModuleNotFoundError
# 解決: 確保在 backend 目錄運行測試
cd C:\Users\admin\Desktop\backend

# Permission denied on temp file
# 解決: 檢查臨時文件目錄權限
# Windows: C:\Users\admin\AppData\Local\Temp
```

---

## 📝 添加新測試

創建新測試文件模板：

```python
import unittest
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

class TestMyFeature(unittest.TestCase):
    def setUp(self):
        """Set up before each test"""
        pass

    def tearDown(self):
        """Clean up after each test"""
        pass

    def test_my_feature(self):
        """Test my feature"""
        self.assertTrue(True)

if __name__ == '__main__':
    unittest.main()
```

---

## 🎯 測試最佳實踐

1. **獨立性**: 每個測試應該獨立運行
2. **清理**: 使用 setUp/tearDown 清理資源
3. **命名**: 使用描述性測試名稱
4. **斷言**: 每個測試至少一個斷言
5. **Mock**: 適當使用 mock 避免外部依賴

---

## 📞 支持

如果測試持續失敗，請檢查：
- `OPTIMIZATION_REPORT.md` - 完整實施文檔
- 各測試文件內的註釋
- 原始代碼邏輯
