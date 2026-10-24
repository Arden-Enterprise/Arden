# Bàn giao Custom Role để matching Mainflow 2

Tài liệu này là điểm bắt đầu cho Khôi khi tiếp tục phần Governance/Mainflow 2. Contract
quyền dưới đây đã được Hung chốt; không nên suy luận lại từ tên role hoặc giao diện cũ.

## 1. Baseline phối hợp

- Nhánh tích hợp: `feat/ard-16-mainflow-2-governance`.
- Custom-role foundation đã có từ commit `32d61d7` (`feat(authz): add scoped custom role management`).
- Phần `ALL_MEMBERS`, migration 0012 và tài liệu này nằm trong commit mới nhất của cùng nhánh.
- `arden-hk` đã ghi nhận migrations 0011/0012. Runtime rehearsal của 0012 đã pass và rollback
  toàn bộ synthetic fixtures; marker hiện có VIEW và không có assignment.
- Migration ledger duy nhất là `apps/api/migrations`; không tạo migration song song ở package khác.
- Môi trường dev chung của Hung/Khôi là `arden-hk` (`dev-3`). Chỉ một người chạy
  `dev:remote`; người còn lại dùng preview để tránh hai source tree cùng ghi vào container.

## 2. Contract quyền đã chốt

### Private và Share

- Private draft thuộc owner theo mặc định. Custom role và Org Admin không được đọc hoặc cấu hình
  quyền private của người khác.
- Mọi active member được tạo/sửa private draft của mình và gửi bản đã lưu vào quy trình Share.
- Share tạo một shared draft/snapshot tách biệt; không biến private thành workspace dùng chung.
- Khi submit, nội dung, hash, classification, scope và audience phải được đóng băng. Sau khi duyệt,
  snapshot đó tự publish và trở thành phiên bản chính thức. Muốn sửa phải quay lại private,
  tạo snapshot mới và đi qua review để thành phiên bản tiếp theo.

### Custom role và scope

- V1 chỉ có một quyền cấu hình: `PUBLISHED_CONTENT_VIEW`. Search/RAG sau này kế thừa VIEW.
- Role thuộc một Organization. Assignment có đúng một scope: Organization hoặc một Department.
- Không có kế thừa Organization -> Department hoặc Department -> Organization.
- Department publication yêu cầu active Department membership và exact active assignment.
- Department default role là role bình thường được tự gán khi thành viên vào phòng ban; không dùng
  nó để giả lập quyền đọc toàn tổ chức.
- Không triển custom DENY, private, review, publish, AI, export hoặc admin permissions trong role V1.

### `ALL_MEMBERS`

- `ALL_MEMBERS` là audience do server quản lý cho toàn Organization, không phải custom role.
- Mỗi Organization có đúng một marker này, với VIEW; marker không nhận role assignment.
- Active organization membership chính là grant. Suspended/left member bị từ chối ngay.
- Chỉ Organization-scoped draft/publication được chọn `ALL_MEMBERS`; Department scope phải từ chối.
- Marker bị ẩn khỏi API/UI quản trị role và không thể đổi tên, sửa, deactivate hoặc assign.
- `ALL_MEMBERS` không cấp private access và không biến Org Admin thành người đọc private.

### Governance

- Tác giả đề xuất classification; reviewer/information owner có thẩm quyền xác nhận.
- Reviewer authority theo Department + classification; Org Admin status tự nó không cho review
  hoặc đọc publication.
- Final approval tự động publish đúng immutable snapshot trong cùng transaction.
- Version/audience/classification thay đổi sau submit phải tạo snapshot và review mới.

## 3. Hung đã triển khai

### Database và policy

- `0011_custom_role_policy_foundation.sql`: owner-private default, role configuration version,
  exact-scope publication checks và migration guard.
- `0012_all_members_organization_audience.sql`: seed marker cho Organization hiện có, bootstrap
  Organization mới, Organization-only validation và assignment-free publication read.
- `tools/roles/policy-rehearsal.sql`: rollback-only rehearsal cho owner isolation, scope separation,
  `ALL_MEMBERS`, VIEW revocation và admin không vượt private boundary.
- Pure policy/API tests bao phủ active/revoked/expired assignments, reserved names, Organization
  member audience và Department rejection.

### Custom-role API

- Server-backed catalog, create/update/deactivate role.
- Exact-scope assign/revoke member.
- Optimistic concurrency bằng configuration version/ETag.
- Audit cùng transaction cho thay đổi cấu hình và assignment.
- Reserved/protected names, permission allowlist và response validation fail closed.
- `ALL_MEMBERS` bị loại khỏi role-management queries.

### UI

- Trang Administration dùng dữ liệu role thật từ API, chỉ hiển thị VIEW.
- Save cấu hình tách khỏi thao tác member assignment; có unsaved-change guard.
- Authoring chỉ hiển thị `ALL_MEMBERS` khi scope là Organization. Đổi sang Department tự loại
  marker khỏi selection và validation chặn request không hợp lệ.
- Web/desktop API contracts và Electron allowlist đã được cập nhật cho các route cần thiết.

Các file chính:

- `apps/api/src/roles/`: policy, store và route/service custom role.
- `apps/api/src/knowledge/policy.ts`: submit/read policy gồm `ALL_MEMBERS`.
- `apps/api/src/db/repository.ts`: bootstrap role, options, audience validation/enforcement.
- `packages/ui/src/knowledge/audience-options.ts`: filter/normalize/validate audience theo scope.
- `packages/ui/src/knowledge/ServerKnowledgeFeaturePage.tsx`: authoring UI.
- `docs/decisions/0009-custom-role-scope-and-owner-defaults.md`: quyết định gốc.

## 4. Việc Khôi cần matching trong Flow 2

1. Giữ `audienceRoles[].kind` là `ROLE | ALL_MEMBERS` từ `GET /knowledge/options` đến UI.
2. Chỉ cho chọn `ALL_MEMBERS` khi `targetScopeType = ORGANIZATION`; API/DB vẫn phải recheck.
3. Lưu UUID marker vào mảng audience hiện có; không tạo assignment giả cho marker.
4. Submission phải freeze audience UUID, target scope, responsible department, classification,
   source version ID, content URI và hash.
5. Trước approve phải rehydrate và kiểm tra audience còn enforceable. Inactive/missing marker hoặc
   invalid Department use phải block approve nhưng vẫn cho reviewer reject.
6. Publication read/list phải dùng current policy/RLS: active membership cho Organization
   `ALL_MEMBERS`; exact assignment + Department membership cho Department role audience.
7. Không thêm Org Admin bypass và không đọc private source để phục vụ review/publication.
8. Hoàn thiện stable document lineage và per-document version (`v1`, `v2`, ...): bản publish mới
   phải trỏ về snapshot mới, giữ lịch sử immutable, và chỉ current approved version được dùng sau này.
9. Khi merge code của Khôi, dùng migration numbering sau 0012 và không sửa migration đã áp dụng.

## 5. Test plan matching

- Active member không có assignment đọc được Organization publication có `ALL_MEMBERS`.
- Suspended/left account, membership hoặc organization bị từ chối.
- Cross-organization actor/marker bị từ chối.
- Save/submit Department draft với `ALL_MEMBERS` bị từ chối ở UI, API và DB trigger.
- Exact Organization role không đọc Department publication; exact Department role không đọc
  Organization publication hoặc Department khác.
- Revoked/expired assignment và role mất VIEW làm access mất hiệu lực ngay.
- Org Admin không nằm trong audience vẫn không đọc custom-audience publication và private draft.
- Review approval publish đúng frozen hash; sửa sau approval tạo version/review mới.
- Hai quyết định đồng thời không sinh hai current publications hoặc trạng thái dở dang.
- RAG/Search sau này chỉ index/retrieve current publication mà chính actor đang đọc được.

Chạy tối thiểu:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:remote
corepack pnpm build
```

SQL rehearsal phải chạy bằng migration owner với `ON_ERROR_STOP=1`; script tự `ROLLBACK` và không
phải reset script. Không copy credential, backup hay thông tin kết nối server vào issue/commit.

## 6. Cách Khôi bắt đầu

```powershell
git fetch origin
git switch feat/ard-16-mainflow-2-governance
git pull --ff-only origin feat/ard-16-mainflow-2-governance
corepack pnpm install
```

Sau khi pull, Khôi nên đối chiếu Flow 2 theo mục 4 trước khi code tiếp. Nếu Hung đang giữ writer
session thì Khôi chỉ preview; nếu không có writer, Khôi có thể chạy `corepack pnpm dev:remote`.
Mọi khác biệt về snapshot schema, lineage/version hoặc response shape cần báo lại trước khi tạo một
policy/migration cạnh tranh.
