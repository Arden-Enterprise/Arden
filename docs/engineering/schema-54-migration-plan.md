# Lộ trình migration Arden về 54 bảng

Maintainer chốt 54 bảng và chọn migration tăng dần trong buổi làm việc ngày 28/11/2026. Baseline Core `staging` là `794cce78`, đối chiếu với `main` `abaa9059`. Catalog baseline có 68 bảng `arden` và 4 bảng `arden_system`. Đích là 50 + 4. [Theo dõi ARD-88](https://linear.app/ardenknowledge/issue/ARD-88/migrate-arden-incrementally-to-the-54-table-schema)

Sau khi review schema, maintainer chốt một đợt cutover và bộ tên đích. Bản nộp duyệt có tên `arden.review_submission`, với `review_submission_id` là tên FK trực tiếp. Các bước dưới đây vẫn dùng để rehearsal và kiểm thử riêng. Tên SQL trong các bước tra theo catalog nguồn, còn tên vật lý đích tra theo bộ schema và ánh xạ đã chốt.

## Kết quả rehearsal local

- **Schema vật lý.** PostgreSQL 18 áp dụng qua `0092` và chạy lại trả `NO_PENDING`. Catalog thực tế khớp 50 bảng `arden`, 4 bảng `arden_system`, 524 cột và từng PK/FK trong bản chốt, gồm 134 FK. `review_submission.id` là PK và bảng tham chiếu dùng `review_submission_id`. Tên cột SQL đổi tại chỗ qua `ALTER TABLE`. Các hàm dùng tên trả về cũ ở những chỗ Core hoặc worker đang lấy dữ liệu theo tên.
- **Web và API.** Đăng nhập Edge với tài khoản QA trên loopback, tạo tổ chức có phòng ban, đọc và chỉnh Direct Share, lưu Private note, nộp duyệt với Target Readers, cấp Reviewer Grant, approve rồi kích hoạt bằng role `arden_indexer`. Bản công bố xuất hiện ở Company và mở được. Cùng tài liệu được đưa vào nguồn AI và Graph khi thành viên có quyền. Actor ngoài tổ chức bị từ chối ở cả ba đường đọc.
- **Tích hợp PostgreSQL.** 105 ca trên 6 suite đạt sau khi chuyển ownership theo mẫu triển khai. Coverage gồm Reviews, quyền đọc, Maintenance, Graph, nguồn và trích dẫn AI, lịch sử chat, System Admin và catalog. Local dùng nguồn và manifest giả lập cho AI. Lịch sử trước `0080` dùng kiểu thay thế cho cột vector đã bị gỡ.
- **Kiểm thử ứng dụng.** 669 ca Core và 695 ca UI đạt. Typecheck toàn workspace và kiểm tra checksum của 92 migration đều đạt. Màn Review permissions chạy trên Web thật đã gỡ Team/Project khỏi form và phần hiển thị quyền.
- **Dữ liệu đã có.** Rehearsal riêng giữ đúng ID, số lần thử, lease và thời điểm của một job đang chạy. Báo cáo đã nhập giữ case hiện tại và ID nguồn. Báo cáo đã đóng giữ kết quả, người xử lý và thời điểm. Thông báo cũ giữ trạng thái đọc và không được phát lại. Trường hợp Q&A legacy còn dữ liệu và trường hợp bản công bố thiếu chính sách người đọc đều dừng ở guard.

| Migration | Số bảng sau bước | Thay đổi |
| --- | ---: | --- |
| `0078`–`0080` | 67 | Gộp Direct Share settings vào Organization và gỡ Q&A legacy |
| `0081`–`0084` | 63 | Chuyển authoring, review và quyền đọc sang Target Readers, gỡ Category, policy và System Admin legacy |
| `0085` | 62 | Đưa dispatch và lease vào Index Generation |
| `0086` | 59 | Gỡ ba bảng Audience, cột nối và đường đọc dự phòng |
| `0087`–`0088` | 55 | Hợp nhất thông báo, báo cáo và lịch sử Maintenance |
| `0089`–`0092` | 54 | Gỡ liên kết Collection cũ, Team/Project, đổi 34 tên bảng và áp dụng tên cột đã chốt |

Các bước thuộc một đợt chuyển đổi. Khi thực hiện trên môi trường dùng chung, cần chạy thử trên bản sao của môi trường đó rồi phối hợp với lần chuyển Core và worker. `0091`–`0092` đổi tên vật lý nên ứng dụng bản trước sẽ không thể dùng lẫn với schema mới. Kết quả tại đây là của môi trường local.

## 1. Gộp cấu hình Direct Share

| Cột nguồn trên `organization_direct_share_setting` | Đích |
| --- | --- |
| `organization_id` | Map vào PK `organization.organization_id` hiện có |
| `enabled` | `organization.direct_share_enabled`, mặc định `true` |
| `recipient_limit` | `organization.direct_share_recipient_limit`, mặc định `10`, giới hạn `1–100` |
| `updated_by_membership_id` | `organization.direct_share_updated_by_membership_id`, FK ghép với `organization_id` |
| `updated_at` | `organization.direct_share_updated_at`, giữ thời điểm cũ |

- **1A, migration `0078`.** Backfill bốn field. Tổ chức chưa từng cấu hình dùng mặc định và attribution rỗng. API và RLS đọc `organization`. Giữ đường ghi cũ và trigger nội bộ cập nhật `organization` trong cùng transaction. Runtime tiếp tục đi qua policy cũ khi Org Admin cập nhật setting. Giữ `private_item_share`, ID, quyền đọc và audit event. Sau 1A vẫn có 72 bảng.
- **1B, migration sau.** Chuyển đường ghi setting sang `organization` qua hàm giới hạn đúng cột và đúng tổ chức. Kiểm tra quyền ghi và audit dưới runtime role, dữ liệu khớp, các instance cũ đã ngừng và phương án recovery. Gỡ trigger, routine tương thích và `organization_direct_share_setting`. Sau khi gỡ, chạy lại case tắt/mở, giới hạn, chia sẻ, xem và revoke.
- **Nghiệm thu.** Tổ chức có setting off và giới hạn khác mặc định. Tổ chức chưa cấu hình. Org Admin cập nhật, Member từ chối. Người nhận mất và lấy lại quyền khi tắt/bật. Trên bản có hai thế hệ code, thao tác ghi cũ phải xuất hiện trong đường đọc mới và cùng rollback nếu transaction lỗi.
- **Bằng chứng.** Fixture gốc giữ cờ tắt, cap 3, membership và cả hai timestamp. Fixture mặc định nhận on/cap 10. Integration F03-SHR qua repository ở role runtime kiểm tra quyền Org Admin và Member, cap, tắt/bật và revoke. Đường ghi mới qua `0079` khớp schema cuối, với thuộc tính actor là `organization.direct_share_updated_by_id`.

## 2. AI và System Admin legacy

- **Giữ** `ai_conversation`, `ai_conversation_turn`, `ai_answer_result`, `ai_answer_feedback`, `ai_turn_evidence`, `ai_turn_surface_binding`, `ai_usage_event`, `ai_price_book`, `private_ai_feedback`. Evidence giữ `turn_id`, `generation_id`, `published_version_id`, `snapshot_version_id`, `snapshot_content_hash` và `chunk_id`. `audit_event` giữ ID, loại event, thời điểm và thông tin actor.
- **Gỡ** `user_question`, `ai_response`, `citation`, `knowledge_chunk` khi các reader/writer cũ đã dừng. Giữ nguyên audit lịch sử, lưu provenance của `audit_event.question_id` theo chính sách lưu trữ rồi gỡ FK/cột. Chroma và nguồn file tiếp tục cung cấp index có thể dựng lại.
- **Gỡ** `arden.system_administrator` và `arden.system_administration_event` sau khi xác minh tài khoản, trạng thái và lịch sử có thể truy vết. **Giữ** `arden_system.administrator`, `admin_session`, `administration_event`, `auth_throttle` trong schema riêng.
- **Nghiệm thu.** Ask Arden, feedback, mở trích dẫn bản hiện hành và lịch sử, dữ liệu analytics. System Admin đăng nhập được, audit giữ actor/target và thời điểm.

## 3. Catalog và policy legacy

- **Giữ** `knowledge_collection` và `knowledge_collection_placement` làm Handbook. Giữ `allowed_types`, `collection_id`, `shared_draft_id`, `placement_revision`. Quy đổi `knowledge_collection_document.published_version_id` về `shared_draft_id`, đối chiếu `collection_id` với placement hiện hành và lưu dấu vết gán cũ khi cần. `ordinal` là thứ tự legacy, chỉ giữ với dữ liệu lịch sử cần đối chiếu.
- **Gỡ** `knowledge_collection_document`, `document_category` và `authorization_policy` sau khi gỡ các consumer. Gỡ `shared_draft.category_id` và `shared_submission.category_id` sau khi đối chiếu dữ liệu Category còn dùng. Giữ metadata Document Type, Document Code và Version. Thẩm định `effect`, `condition_json`, `status` và `effective_from` của `authorization_policy` trước retirement.
- **Giữ** `document_relationship` cùng hai FK nguồn/đích và `document_relationship_idempotency`. **Nghiệm thu** tạo tổ chức, placement, chuyển/gỡ, archive Handbook, lọc Document Type, Graph và phép đọc theo Target Readers.

## 4. Maintenance reports và notifications

- **Giữ** `maintenance_case`, `maintenance_case_event`, `maintenance_case_link`, `maintenance_analysis_run`, `maintenance_idempotency`. Giữ FK ghim `published_version_id` và thông tin reporter, assignee, route department, outcome, thời điểm. Chuyển `publication_report.report_id`, message, created/closed, người đóng và resolution sang case/event tương ứng. Ghi provenance của `maintenance_report_import` gồm `report_id`, `case_id`, `created_at` vào sự kiện import với ID nguồn dùng để chống trùng. Gỡ hai bảng sau khi kiểm tra cả báo cáo đã và chưa import.
- **Gộp** `maintenance_notification` và `maintenance_notification_receipt` vào `arden_notification`. Giữ `notification_id`, `recipient_membership_id`, `created_at`, `read_at`. `case_id` đi vào `resource_id` với loại case. Map `logical_key` sang `event_key` có prefix riêng. Giữ nội dung hiển thị `message` trong snapshot thông báo tối thiểu nếu đường đọc hiện tại cần nó. Giữ `arden_notification_outbox` và khóa dedupe. Bản ghi lịch sử giữ trạng thái cũ, tránh phát lại thông báo đã gửi.
- **Nghiệm thu.** My reports và Maintenance queue, lịch sử báo cáo đóng, replay import, bộ đếm unread, mark read và retry dispatch.

## 5. Gộp Index Job vào Index Generation

- **Giữ** `knowledge_index_generation.generation_id`, `submission_id`, `shared_draft_id`, snapshot ID/hash, `status`, `manifest_json`, `failure_code` và timestamps.
- **Gộp** `knowledge_index_job.status` vào `job_status`, cùng `attempt_count`, `max_attempts`, `available_at`, `lease_owner`, `lease_expires_at`, `last_error_code`. Rà `job_id` và thời điểm hoàn tất job ở worker, logs và đối soát. Duy trì hợp đồng worker hiện tại trong giai đoạn chuyển phiên bản rồi gỡ bảng job.
- **Nghiệm thu.** Worker cũ và mới, claim đồng thời, lease hết hạn, worker cũ trả kết quả muộn, retry thất bại, quyền truy xuất và bản đang công bố khi lần index thay thế lỗi.

## 6. Bỏ Team/Project và Audience legacy

Maintainer xác nhận dữ liệu Team/Project và Audience Role đã được gỡ. Các cột dưới đây là ứng viên xóa khỏi schema đích. Baseline code vẫn còn câu truy vấn, type và SQL function nhắc tới chúng. Việc của phase này là xóa những phụ thuộc đó và kiểm tra dữ liệu live nhất quán với phạm vi đã chốt.

| Bỏ | Trên bảng | Giữ |
| --- | --- | --- |
| `team_tag`, `project_tag` | `shared_draft`, `shared_submission`, `published_knowledge_version`, `reviewer_grant`, `maintenance_case` | Phòng chịu trách nhiệm, reviewer scope/grant, thông tin định tuyến case |
| `audience_role_ids` | `shared_submission`, `published_knowledge_version`, `knowledge_current_publication` | `draft_selection_id`, `proposed_selection_id`, `approved_selection_id`, `reader_selection_id` tại nơi tương ứng |
| `audience`, `audience_group_membership`, `shared_draft_audience` | Ba bảng legacy | `reader_selection`, `selected_reader`, RBAC và các policy dựa vào membership |

- Dọn types và fixtures, SQL đọc/ghi, policy, indexes và hàm dựng quyền trước khi drop. Giữ `review_rule` và các mốc hiệu lực đang được workflow query cho đến khi rà riêng được tác dụng của chúng. `published_at` và `valid_until` có ý nghĩa riêng.
- **Nghiệm thu.** Preflight kiểm tra không còn bản công bố/bản nộp phụ thuộc vào legacy. Kiểm tra Organization, Department, Selected Members, thành viên đã rời, reviewer scope, PDF, nguồn Ask Arden, lịch sử citation và Graph. Dừng migration ở môi trường có dữ liệu ngoài điều kiện này để xử lý riêng.
- **Backfill phạm vi Organization.** `0083` phục hồi Target Readers còn trống khi bản ghi có duy nhất Audience `ORGANIZATION_ALL` đang hoạt động của chính tổ chức. Bản nộp duyệt giữ quyết định cũ và reviewer scope. Phiên bản lịch sử chỉ được backfill nếu khớp Audience của bản nộp đã duyệt và nằm ngoài current pointer. Bản ghi có phạm vi không xác định vẫn dừng ở các guard.

## Các bảng giữ theo ranh giới nghiệp vụ

- Identity giữ Account, Organization, Membership, Invitation, Department, Department Membership, Role, Permission, Role Assignment, Role Permission, Reviewer Grant và Access Scope. Giữ các FK membership theo vai trò thực tế của tác giả, reviewer, người nhận và actor.
- Private giữ Workspace, Folder, Document, Version và Item Share. Company giữ Knowledge Base, Working Draft, Working Version, Submission, Review Decision, Published Version, Current Publication, Renewal, Inspect, Reader Selection và Selected Reader.
- Sau khi hoàn tất từng đợt, kiểm tra lại PK/FK và đếm bảng vật lý trong `arden` và `arden_system`. So sánh latency và query plan của các đường query được đụng tới. Mốc 54 mô tả schema đích.
