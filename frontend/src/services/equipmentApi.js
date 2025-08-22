// src/services/equipmentApi.js
import api from "./api";

const equipmentApi = {
  // 發送設備數據
  postEquipmentData: (data) => 
    api.post("Module_Equipment/data", data),

  // 取得每日統計
  getDailyStats: (targetDate = null) => 
    api.get("Module_Equipment/stats/daily", {
      params: targetDate ? { target_date: targetDate } : {}
    }),

  // 取得日期範圍統計
  getRangeStats: (startDate, endDate, processType = null) => 
    api.get("Module_Equipment/stats/range", {
      params: {
        start_date: startDate,
        end_date: endDate,
        ...(processType && { process_type: processType })
      }
    }),

  // 取得儀表板數據
  getDashboardData: (targetDate = null) => 
    api.get("Module_Equipment/dashboard", {
      params: targetDate ? { target_date: targetDate } : {}
    }),

  // 取得所有製程類型
  getProcessTypes: () => 
    api.get("Module_Equipment/process-types"),

  // 取得使用者統計
  getUserStats: (targetDate = null) => 
    api.get("Module_Equipment/user-stats", {
      params: targetDate ? { target_date: targetDate } : {}
    }),

  // 取得最近記錄
  getRecentRecords: (limit = 10) => 
    api.get("Module_Equipment/recent-records", { params: { limit } }),
};

export default equipmentApi;