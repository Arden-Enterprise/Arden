import { useEffect, useMemo, useState } from "react";
import { ApiError, getSystemConsoleOrganization, getSystemConsoleReport, type SystemConsoleQuery,
  type SystemConsoleReport, type SystemConsoleReportName } from "../shared/api-client";
import type { Platform } from "../shared/types";

type Section = SystemConsoleReportName;
/** Sections whose report returns a bounded page of rows (at most 50). */
const pagedSections = new Set<Section>(["organizations", "contributions", "quality"]);
type Props = { platform: Platform; onSignOut: () => void };
type Row = Record<string, unknown>;
const nav: Array<{ id: Section; label: string; description: string }> = [
  { id: "overview", label: "Tổng quan", description: "Toàn cảnh hệ thống" },
  { id: "organizations", label: "Tổ chức", description: "Trạng thái và quy mô" },
  { id: "knowledge", label: "Kho tri thức", description: "Trạng thái và đóng góp" },
  { id: "ai-usage", label: "Sử dụng AI", description: "Lượt gọi, độ trễ và chi phí" },
  { id: "contributions", label: "Đóng góp tri thức", description: "Tổng hợp theo tổ chức và phòng ban" },
  { id: "feedback", label: "Phản hồi AI & lỗi", description: "Đánh giá và case đang mở" },
  { id: "private-feedback", label: "Phản hồi Private Notes", description: "Đánh giá theo tuần (UTC)" },
  { id: "quality", label: "Chất lượng tri thức", description: "Các tín hiệu cần rà soát" },
  { id: "health", label: "Sức khỏe hệ thống", description: "Trạng thái dịch vụ và hàng đợi" },
];
const labelNames: Record<string, string> = {
  organizations: "Tổ chức", total: "Tổng số", active: "Đang hoạt động", suspended: "Tạm dừng", archived: "Đã lưu trữ",
  knowledge: "Kho tri thức", drafts: "Bản nháp", activeDrafts: "Đang hoạt động", archivedDrafts: "Đã lưu trữ",
  publications: "Xuất bản", current: "Hiện hành", expired: "Hết hiệu lực", contributions: "Đóng góp",
  pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối", ai: "AI", calls: "Lượt usage ghi nhận",
  inputTokens: "Token đầu vào", outputTokens: "Token đầu ra", estimatedCostMicroUsd: "Chi phí ước tính (USD)",
  avgLatencyMs: "Độ trễ trung bình (ms)", citationRate: "Câu trả lời có trích dẫn (%)",
  usageComplete: "Đủ token/giá cho sự kiện ghi nhận", positive: "Tích cực",
  negative: "Tiêu cực", openCases: "Case đang mở", caseAgeOver30Days: "Mở trên 30 ngày",
  status: "Trạng thái", createdAt: "Ngày tạo", published: "Đang xuất bản", storageBytes: "Dữ liệu tham chiếu (bytes)",
  organizationId: "Mã tổ chức", departmentId: "Mã phòng ban", submitted: "Đã gửi", operation: "Thao tác",
  provider: "Nhà cung cấp", model: "Model", documentRef: "Mã tài liệu ẩn danh", signal: "Tín hiệu",
  count: "Số lượng", database: "Core / Database", indexing: "Hàng đợi indexing", notifications: "Hàng đợi thông báo",
  oldestPendingSeconds: "Tuổi dòng chờ lâu nhất (giây)",
  auth: "Auth", ardenAi: "Arden-AI", latencyMs: "Độ trễ (ms)", failed: "Lỗi", running: "Đang chạy",
  weekStart: "Tuần bắt đầu", good: "Tốt", bad: "Chưa tốt",
};

function record(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null;
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is Row => item !== null) : [];
}
function display(key: string, value: unknown): string {
  if (value === null || value === undefined) return "Chưa đủ dữ liệu";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") {
    if (key === "estimatedCostMicroUsd") return `$${(value / 1_000_000).toFixed(4)}`;
    return value.toLocaleString("vi-VN");
  }
  if (typeof value === "string") {
    // PostgreSQL returns timestamps as ISO strings.
    if (key === "createdAt") {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("vi-VN");
    }
    const statuses: Record<string, string> = { ok: "Bình thường", unavailable: "Không khả dụng",
      not_configured: "Chưa cấu hình", degraded: "Cần kiểm tra", ACTIVE: "Đang hoạt động", SUSPENDED: "Tạm dừng", ARCHIVED: "Đã lưu trữ",
      OPEN: "Đang mở", REVIEW: "Cần rà soát", EXPIRED: "Hết hiệu lực" };
    return statuses[value] ?? value;
  }
  return "";
}
function label(key: string) { return labelNames[key] ?? key; }
function metrics(value: Row, prefix = ""): Array<{ label: string; value: unknown; key: string }> {
  const result: Array<{ label: string; value: unknown; key: string }> = [];
  for (const [key, item] of Object.entries(value)) {
    const title = prefix ? `${prefix} · ${label(key)}` : label(key);
    const nested = record(item);
    if (nested) result.push(...metrics(nested, title));
    else if (!Array.isArray(item)) result.push({ label: title, value: item, key });
  }
  return result;
}
function isoDay(value: Date) { return value.toISOString().slice(0, 10); }
function formatDateRange(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const fromDate = new Date(`${from}T00:00:00.000Z`), toDate = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.valueOf()) || Number.isNaN(toDate.valueOf()) || fromDate > toDate) return null;
  const exclusiveTo = toDate.valueOf() + 24 * 60 * 60 * 1000;
  if (exclusiveTo - fromDate.valueOf() > 366 * 24 * 60 * 60 * 1000) return null;
  return { from: fromDate.toISOString(), to: new Date(exclusiveTo).toISOString() };
}
function safeError(error: unknown) {
  return error instanceof ApiError && error.status === 404 ? "Bạn không có quyền truy cập System Console." : "Không thể tải báo cáo. Vui lòng thử lại.";
}

export function SystemConsolePage({ platform, onSignOut }: Props) {
  const [section, setSection] = useState<Section>("overview");
  const [report, setReport] = useState<SystemConsoleReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<"7" | "30" | "90" | "custom">("30");
  const today = isoDay(new Date());
  const [fromDay, setFromDay] = useState(() => isoDay(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)));
  const [toDay, setToDay] = useState(today);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedOrganization, setSelectedOrganization] = useState<string | null>(null);
  const query = useMemo(() => {
    const range = formatDateRange(fromDay, toDay);
    if (!range) return null;
    return { ...range,
    ...(section === "organizations" ? { search, status } : {}),
    ...(pagedSections.has(section) && !selectedOrganization ? { page, pageSize } : {}),
    ...(selectedOrganization ? { organizationId: selectedOrganization } : {}),
    } satisfies SystemConsoleQuery;
  }, [fromDay, toDay, section, search, status, page, pageSize, selectedOrganization]);

  useEffect(() => {
    if (preset === "custom") return;
    const end = new Date();
    setToDay(isoDay(end)); setFromDay(isoDay(new Date(end.valueOf() - (Number(preset) - 1) * 24 * 60 * 60 * 1000)));
  }, [preset]);

  useEffect(() => {
    let current = true;
    if (!query) {
      setLoading(false); setReport(null);
      setError("Chọn khoảng ngày hợp lệ tối đa một năm.");
      return () => { current = false; };
    }
    setLoading(true); setError(null);
    const request = selectedOrganization
      ? getSystemConsoleOrganization(platform, selectedOrganization, query)
      : getSystemConsoleReport(platform, section, query);
    void request.then(data => { if (current) setReport(data); })
      .catch(cause => { if (current) { setReport(null); setError(safeError(cause)); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [platform, section, query, selectedOrganization]);

  const sectionInfo = nav.find(item => item.id === section)!;
  const orgItems = rows(report?.items);
  const total = typeof report?.total === "number" ? report.total : 0;
  const flatMetrics = report ? metrics(report) : [];
  const listSection = section === "organizations" && !selectedOrganization;

  return <main className="system-console" id="arden-main">
    <aside className="system-console-sidebar">
      <div className="system-console-brand"><span className="system-console-mark">A</span><div><strong>Arden</strong><small>System Console</small></div></div>
      <nav aria-label="System Console">
        {nav.map(item => <button type="button" key={item.id} className={section === item.id ? "is-active" : ""}
          aria-current={section === item.id ? "page" : undefined} onClick={() => { setSection(item.id); setSelectedOrganization(null); setPage(1); }}>
          <strong>{item.label}</strong><small>{item.description}</small>
        </button>)}
      </nav>
      <button type="button" className="system-console-signout" onClick={onSignOut}>Đăng xuất</button>
    </aside>
    <div className="system-console-main">
      <header className="system-console-header">
        <div><p className="system-console-eyebrow">INSTANCE MONITORING</p><h1>{selectedOrganization ? "Chi tiết tổ chức" : sectionInfo.label}</h1>
          <p>{selectedOrganization ? "Chỉ số vận hành và trạng thái tổ chức." : sectionInfo.description}</p></div>
        <div className="system-console-live"><span /> Chỉ xem</div>
      </header>
      <section className="system-console-filters" aria-label="Bộ lọc thời gian">
        <label>Khoảng thời gian<select value={preset} onChange={event => setPreset(event.target.value as typeof preset)}>
          <option value="7">7 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option><option value="custom">Tùy chỉnh</option>
        </select></label>
        {preset === "custom" && <>
          <label>Từ ngày<input type="date" value={fromDay} onChange={event => setFromDay(event.target.value)} /></label>
          <label>Đến ngày<input type="date" value={toDay} onChange={event => setToDay(event.target.value)} /></label>
        </>}
        {selectedOrganization && <button type="button" className="system-console-link" onClick={() => setSelectedOrganization(null)}>← Quay lại danh sách</button>}
      </section>
      {listSection && <section className="system-console-org-filters" aria-label="Lọc tổ chức">
        <label>Tìm tổ chức<input value={search} maxLength={120} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Tên tổ chức" /></label>
        <label>Trạng thái<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Tất cả</option><option value="ACTIVE">Đang hoạt động</option><option value="SUSPENDED">Tạm dừng</option><option value="ARCHIVED">Đã lưu trữ</option>
        </select></label>
        <label>Số dòng<select value={pageSize} onChange={event => { setPageSize(Math.min(50, Number(event.target.value))); setPage(1); }}>
          <option value={25}>25</option><option value={50}>50</option>
        </select></label>
      </section>}
      {error && <div role="alert" className="system-console-error">{error}</div>}
      {loading && <p role="status" className="system-console-loading">Đang tải số liệu…</p>}
      {!loading && !error && report && <>
        {listSection ? <>
          <div className="system-console-table-wrap"><table className="system-console-table">
            <thead><tr><th>Tổ chức</th><th>Trạng thái</th><th>Bản nháp</th><th>Đang xuất bản</th><th>Case mở</th><th /></tr></thead>
            <tbody>{orgItems.map(item => <tr key={String(item.id)}>
              <td><strong>{display("name", item.name)}</strong><small>{String(item.id ?? "")}</small></td>
              <td><span className={`system-console-status status-${String(item.status).toLowerCase()}`}>{display("status", item.status)}</span></td>
              <td>{display("drafts", item.drafts)}</td><td>{display("published", item.published)}</td><td>{display("openCases", item.openCases)}</td>
              <td><button type="button" className="system-console-link" onClick={() => setSelectedOrganization(String(item.id))}>Chi tiết</button></td>
            </tr>)}</tbody>
          </table>{orgItems.length === 0 && <p className="system-console-empty">Không tìm thấy tổ chức.</p>}</div>
          <Pagination total={total} page={page} pageSize={pageSize} unit="tổ chức" onPage={setPage} />
        </> : <>
          <div className="system-console-metrics">{flatMetrics.map((item, index) => <article className="system-console-metric" key={`${item.label}:${index}`}>
            <span>{item.label}</span><strong>{display(item.key, item.value)}</strong>
          </article>)}</div>
          {section === "ai-usage" && <>
            <p className="system-console-footnote">Số lượt phản ánh các sự kiện usage đã ghi nhận; yêu cầu lỗi hoặc lần thử lại nội bộ của nhà cung cấp có thể chưa được tính. Chi phí chỉ là ước tính theo bảng giá đã cấu hình.</p>
            <RowsTable title="Theo loại thao tác" data={rows(report.byOperation)} columns={["operation", "provider", "model", "calls", "inputTokens", "outputTokens", "estimatedCostMicroUsd", "usageComplete"]} />
          </>}
          {section === "overview" && <p className="system-console-footnote">Usage phản ánh các sự kiện đã ghi nhận; yêu cầu lỗi hoặc lần thử lại nội bộ của nhà cung cấp có thể chưa được tính.</p>}
          {section === "contributions" && <RowsTable title="Theo tổ chức và phòng ban" data={rows(report.items)} columns={["organizationId", "departmentId", "submitted", "approved", "rejected", "pending"]} />}
          {section === "quality" && <RowsTable title="Tín hiệu chất lượng" data={rows(report.items)} columns={["documentRef", "signal", "count", "status"]} />}
          {(section === "contributions" || section === "quality") && <Pagination total={total} page={page} pageSize={pageSize}
            unit="dòng" onPage={setPage} />}
          {section === "private-feedback" && <RowsTable title="12 tuần gần nhất" data={rows(report.weeks)} columns={["weekStart", "good", "bad"]} />}
          {selectedOrganization && <p className="system-console-footnote">Dung lượng tính theo byte dữ liệu được tham chiếu. Thiếu dữ liệu lịch sử sẽ hiển thị “Chưa đủ dữ liệu”.</p>}
          {section === "health" && <p className="system-console-footnote">Thông tin lỗi và trạng thái đã được làm sạch; Console không cung cấp thao tác điều khiển dịch vụ.</p>}
        </>}
      </>}
    </div>
  </main>;
}

function Pagination({ total, page, pageSize, unit, onPage }: { total: number; page: number; pageSize: number; unit: string;
  onPage: (update: (value: number) => number) => void }) {
  return <div className="system-console-pagination"><span>{total.toLocaleString("vi-VN")} {unit}</span>
    <button type="button" disabled={page <= 1} onClick={() => onPage(value => Math.max(1, value - 1))}>Trước</button>
    <span>Trang {page}</span><button type="button" disabled={page * pageSize >= total} onClick={() => onPage(value => value + 1)}>Sau</button>
  </div>;
}

function RowsTable({ title, data, columns }: { title: string; data: Row[]; columns: string[] }) {
  if (!data.length) return <section className="system-console-report-table"><h2>{title}</h2><p className="system-console-empty">Chưa có dữ liệu trong khoảng này.</p></section>;
  return <section className="system-console-report-table"><h2>{title}</h2><div className="system-console-table-wrap"><table className="system-console-table">
    <thead><tr>{columns.map(column => <th key={column}>{label(column)}</th>)}</tr></thead>
    <tbody>{data.map((row, index) => <tr key={index}>{columns.map(column => <td key={column}>{display(column, row[column])}</td>)}</tr>)}</tbody>
  </table></div></section>;
}
