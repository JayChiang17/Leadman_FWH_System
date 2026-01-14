// src/services/equipmentApi.js
import api from "./api";

// 後端是 /api/module_equipment（全部小寫 + 底線）
const base = "module_equipment";

const equipmentApi = {
  // 上報資料
  postEquipmentData: (data) => api.post(`${base}/data`, data),

  // 每日統計
  getDailyStats: (targetDate = null) =>
    api.get(`${base}/stats/daily`, {
      params: targetDate ? { target_date: targetDate } : {},
    }),

  // 區間統計（天粒度）
  getRangeStats: (startDate, endDate, processType = null) =>
    api.get(`${base}/stats/range`, {
      params: {
        start_date: startDate,
        end_date: endDate,
        ...(processType && { process_type: processType }),
      },
    }),

  // 24 小時使用（熱度/每小時件數）
  getHourlyUsage: (targetDate = null, processType = null) =>
    api.get(`${base}/stats/hourly-usage`, {
      params: {
        ...(targetDate && { target_date: targetDate }),
        ...(processType && { process_type: processType }),
      },
    }),

  // 「每天 × 工位」明細（小 multiples 會用）
  getPerStationDaily: (startDate, endDate, processType = null) =>
    api.get(`${base}/stats/per-station-daily`, {
      params: {
        start_date: startDate,
        end_date: endDate,
        ...(processType && { process_type: processType }),
      },
    }),

  // Dashboard（可不用）
  getDashboardData: (targetDate = null) =>
    api.get(`${base}/dashboard`, {
      params: targetDate ? { target_date: targetDate } : {},
    }),

  // 工位/製程清單
  getProcessTypes: () => api.get(`${base}/process_types`),

  // 當日使用者 KPI
  getUserStats: (targetDate = null) =>
    api.get(`${base}/user-stats`, {
      params: targetDate ? { target_date: targetDate } : {},
    }),

  // 最新明細
  getRecentRecords: (limit = 10) =>
    api.get(`${base}/recent-records`, { params: { limit } }),
};

export default equipmentApi;
