# Open questions: review authority, ownership and readers (Mainflow 2)

> **Ghi chú thảo luận, không phải quy tắc.** File này gom những điểm người dùng (chủ dự án Arden) còn thắc mắc hoặc đang thảo luận, để một AI khác đọc và góp ý. Những gì đã quyết định nằm trong decision record được trích dẫn; những gì ghi "đề xuất" hay "câu hỏi mở" thì **chưa** được chấp nhận.
>
> Ngày: 2026-10-26 · Nhánh: `feat/ard-16-knowledge-workflow-updates`

## 0. Bối cảnh tối thiểu

- **Arden:** nền tảng tri thức nội bộ, self-hosted. Mainflow 2 = thành viên soạn **shared draft** → submit một **snapshot bất biến** → người duyệt **Approve / Reject** → snapshot được chuẩn bị index rồi kích hoạt.
- **Cấu trúc repo:**
  - API: `apps/api` (Fastify + PostgreSQL có RLS).
  - UI dùng chung web/desktop: `packages/ui`.
  - Quy tắc repo: `AGENTS.md`.
  - Decision record: `docs/decisions/`.
- **Khái niệm đã chấp nhận:**
  - **Audience** (decision 0010) chỉ quyết định *ai được đọc*. Có ba loại: `ORGANIZATION_ALL`, `DEPARTMENT_ALL`, `GROUP`. Không có audience cho từng người riêng lẻ, cũng không có "deny".
  - **Reviewer Grant** quyết định *ai được duyệt*. Theo decision 0015, grant có phạm vi **phòng ban** hoặc **toàn tổ chức**, kèm tag team/project tùy chọn và thời hạn; cấp reviewer không còn là lựa chọn sản phẩm.
  - **Organization Admin** (decision 0011) được quyết định mọi submission, **kể cả tự duyệt bài của mình**, có ghi audit `selfApproved`.
  - Mọi quyết định duyệt áp lên đúng snapshot đã đóng băng (nội dung, hash, audience, phòng ban).

## 1. Đã làm trong các phiên gần đây (để AI biết trạng thái)

| Việc | Record | Trạng thái |
|---|---|---|
| Bỏ classification (`INTERNAL/CONFIDENTIAL/RESTRICTED`) khỏi luồng tác giả; cấp người duyệt suy ra từ **độ rộng người đọc** | [0013](../../decisions/0013-audience-breadth-review-levels.md) | Phase 1a đã commit (`5e0def7`) và push |
| Phòng ban phụ trách = **phòng ban chính của người upload**, server tự suy ra; bỏ ô chọn | [0014](../../decisions/0014-author-owns-shared-drafts.md) | Đã code, test pass, **chưa commit** |
| Grant reviewer có phạm vi `DEPARTMENT` / `ORGANIZATION`, bỏ cấp khỏi sản phẩm | [0015](../../decisions/0015-organization-wide-reviewer-grants.md) | Đã code trong checkout, chưa có bằng chứng PostgreSQL, **chưa commit** |
| Picker "Who can read it" (Organization / Department / Groups); scope suy ra từ người đọc | DESIGN.md | Đã commit |

**Quy tắc duyệt mới theo 0015:**

| Người đọc của snapshot | Ai được duyệt |
|---|---|
| Phòng ban, hoặc chỉ group | Grant `DEPARTMENT` đang hoạt động của **phòng ban phụ trách** |
| Có `ORGANIZATION_ALL` (toàn tổ chức) | Grant `ORGANIZATION` đang hoạt động |
| Mọi trường hợp | Org Admin được quyết định (0011) |

**Giới hạn kỹ thuật cần biết:**
- **Migration 0020 đã được viết nhưng chưa chạy trên PostgreSQL.** Hàm RLS `actor_has_reviewer_grant` giữ chữ ký cũ nên là điều kiện rộng; policy TypeScript mới là cổng chính xác cho scope và `review_rule`. Quyền thực tế vẫn cần cả DB và TS.
- **Chưa từng chạy trên PostgreSQL thật.** Máy phát triển không có PostgreSQL; test tích hợp DB tự bỏ qua khi thiếu `ARDEN_TEST_DATABASE_URL`. Các câu SQL mới (tính "toàn tổ chức", lấy phòng ban chính) chưa chạy trên database thật.
- **Slot dev-3 đang chạy code cũ.** Người dùng đang chạy `pnpm remote:preview --slot dev-3`, lệnh này **không upload code**. Push lên GitHub cũng không cập nhật slot; phải chạy `pnpm dev:remote --slot <slot>`. Đây là nguyên nhân lỗi "The request is invalid" đã gặp.

## 2. Đã giải quyết: tài liệu toàn tổ chức do ai duyệt?

**Người dùng hỏi:** "Nếu chọn organization thì người duyệt phải có quyền duyệt cấp org chứ, tại sao lại *reviewed by Engineer*?"

**Đã chốt trong [decision 0015](../../decisions/0015-organization-wide-reviewer-grants.md):** Org Admin có thể cấp grant phạm vi `ORGANIZATION` không gắn với phòng ban. Grant này duyệt snapshot có audience `ORGANIZATION_ALL`; grant `DEPARTMENT` duyệt snapshot phòng ban hoặc chỉ group của phòng ban phụ trách. Hai phạm vi không kế thừa nhau và chỉ cần một người duyệt.

**Quy tắc đã chấp nhận:**
- Khi tạo grant, Org Admin chọn **Phòng ban** (như hiện nay) hoặc **Toàn tổ chức**. Grant toàn tổ chức không gắn với phòng ban nào.
- Quy tắc:
  - Tài liệu phòng ban hoặc group → grant của phòng ban sở hữu.
  - Tài liệu toàn tổ chức → **grant toàn tổ chức**, hoặc Org Admin.
- Grant toàn tổ chức **không** tự động duyệt được tài liệu nội bộ của phòng ban, và ngược lại.
- Phòng ban sở hữu (người upload) vẫn chịu trách nhiệm nội dung; chỉ quyền duyệt chuyển lên cấp tổ chức.
- Giao diện cảnh báo trước khi submit nếu tổ chức chưa có ai giữ grant toàn tổ chức, để tài liệu không bị kẹt.

**Cách triển khai đã chấp nhận:**
- Migration: thêm cột phạm vi vào `reviewer_grant`, cho phép `department_id` để trống khi phạm vi là toàn tổ chức.
- Sửa thân hàm `actor_has_reviewer_grant` nhưng **giữ nguyên chữ ký** (database cho phép thêm trường hợp grant toàn tổ chức, server TS áp quy tắc chặt), để khỏi viết lại khoảng 15 RLS policy và trigger đang gọi hàm này.
- Migration 0020 thêm `scope`, `review_rule` và availability function. Vẫn cần chạy thử trên một database tạm `arden_test_*`.

**Chuyển tiếp và nợ kỹ thuật:** submission cũ mang `review_rule = LEGACY`, nên tài liệu toàn tổ chức cũ vẫn nhận Specialist/Senior của phòng ban hoặc grant Organization. Submission mới mang `GRANT_SCOPE`. Hàm SQL giữ chữ ký cũ và rộng hơn policy chính xác ở TypeScript; đây là nợ kỹ thuật phải siết lại khi contraction schema. Chưa có bằng chứng PostgreSQL vì thiếu `ARDEN_TEST_DATABASE_URL`.

## 3. Đã giải quyết: `SPECIALIST` và `SENIOR` rời khỏi sản phẩm

**Người dùng hỏi:** "Standard/Specialist/Senior khác gì nhau?", rồi "Vậy tạo ra Senior làm gì trong khi giống hệt Specialist?"

**Sự thật trong code:**
- Cấp chỉ được dùng ở hai điều kiện, cả hai viết `level === "SPECIALIST" || level === "SENIOR"`: tài liệu RESTRICTED cũ, và tài liệu toàn tổ chức. Xem `apps/api/src/knowledge/policy.ts` và hàm SQL trong migration 0010.
- **Không có chỗ nào phân biệt Specialist với Senior.** Khác biệt duy nhất là tên hiển thị.
- **Nguồn gốc:** decision 0008 viết "a specialist **or** senior reviewer" (một chuyên gia lĩnh vực, hoặc một người thâm niên). Commit `308fe2f` (2026-10-13) biến cụm từ đó thành hai giá trị riêng có cùng hiệu lực. 0008 cũng để ngỏ "bước duyệt thứ hai theo chính sách tổ chức"; phần này chưa bao giờ được thiết kế.

**Đã chốt trong 0015:** UI và API client không còn hỏi cấp; grant mới lưu `STANDARD`. Cột `level` và các giá trị Specialist/Senior vẫn được giữ tạm thời để các submission `LEGACY`, nhất là `RESTRICTED`, tiếp tục theo luật cũ. Chỉ xóa cột bằng migration contraction sau khi không còn submission cũ cần nó.

## 4. Câu hỏi mở về người đọc là group

- **Group chỉ quyết định ai đọc, không quyết định ai duyệt** (0010). Lý do: group có thể gồm người nhiều phòng ban; nếu group quyết định người duyệt thì thêm người vào group là chuyển được quyền duyệt.
- **Khi chỉ chọn group,** scope mặc định là **Organization**: thành viên group thuộc bất kỳ phòng ban nào cũng đọc được. Có ô tick "Only group members who are also in {phòng ban}" để thu về **Department**.
- **Khi chỉ có group (kể cả scope Organization),** người duyệt vẫn là người của phòng ban sở hữu, ở cấp thường.

**Cần AI góp ý:**
1. Group vượt nhiều phòng ban với scope Organization có nên được coi là "rộng" và cần người duyệt cấp tổ chức không, hay chỉ `ORGANIZATION_ALL` mới tính là rộng?
2. Mặc định scope Organization cho trường hợp chỉ có group có đúng không, hay nên mặc định Department (an toàn hơn)?

## 5. Câu hỏi mở về chủ sở hữu và phòng ban (0014)

**Đã chốt:** người upload là người chịu trách nhiệm; phòng ban phụ trách = phòng ban chính của họ; server tự suy ra và từ chối mọi phòng ban khác. Khi submit, phòng ban phải khớp với phòng ban chính hiện tại. Người chưa có phòng ban chính thì không submit được.

**Câu hỏi còn lại:**
1. Người thuộc **nhiều phòng ban**: hiện chỉ dùng phòng ban chính, không cho đổi. Có cần cho chọn trong số phòng ban của chính họ không?
2. Người upload **chuyển phòng ban** sau khi tài liệu đã xuất bản: ai chịu trách nhiệm cập nhật? Phòng ban cũ (phòng ban gắn với bản xuất bản) hay phòng ban mới?
3. Người upload **rời tổ chức**: chuyển quyền sở hữu thế nào? Hiện chưa có tính năng chuyển owner.

## 6. Các điểm treo khác

- **Classification (0013):**
  - Phase 1b (migration database, `policy_version = 2`, đóng băng cấp duyệt yêu cầu) và phase 2 (xóa cột) chưa làm.
  - `AGENTS.md` §2 mục 5 vẫn ghi ba mức classification là quyết định đã chấp nhận; cần người dùng duyệt rõ mới được sửa vì là quy tắc chung của repo.
  - Repo `Arden-AI` (dịch vụ Python) chưa được kiểm tra xem có dùng classification không.
- **Người đọc là từng cá nhân** (audience `DIRECT_MEMBER`): ngoài phạm vi V1 theo 0010. Muốn có thì cần decision record. Rủi ro: lộ danh bạ, thu hồi quyền khi người đó rời tổ chức hoặc phòng ban, vượt ranh giới phòng ban.
- **Câu chữ trên giao diện:** đã sửa thành "no reviewer can approve their own submission", đúng với ngoại lệ Org Admin của 0011.
- **Deploy:** cần `pnpm dev:remote --slot dev-3` (nếu dev-3 là slot của người dùng) rồi thử lưu và submit với một người có phòng ban chính và một người không có. Đây cũng là lần đầu các câu SQL mới chạy trên database thật.

## 7. Điều AI đọc file này nên tuân thủ

- **Không được bỏ** các bất biến trong `AGENTS.md` §2 và §7: audience chỉ là quyền đọc; mọi entry point đều kiểm quyền, mặc định từ chối; duyệt trên snapshot bất biến; thu hồi quyền có hiệu lực ngay; không lộ dữ liệu ẩn qua số đếm hay gợi ý.
- **Thay đổi quyết định đã chấp nhận phải có decision record mới,** không âm thầm sửa record cũ.
- **Phân biệt** đề xuất / đã chấp nhận / đã triển khai / đã có bằng chứng test.
- **Đề xuất nào cần migration** phải kèm kế hoạch chạy thử trên database tạm và quy tắc chuyển tiếp cho dữ liệu đang chờ duyệt.
