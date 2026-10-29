# Hướng dẫn làm việc với Staging dùng chung

Cập nhật: 2026-10-29. Phạm vi: nhóm được maintainer chuyển sang Staging dùng chung. Tài liệu có thể gửi riêng cho thành viên mới; không chứa thông tin đăng nhập hoặc địa chỉ hạ tầng riêng.

## 1. Mô hình đã chốt

Nhóm dùng hai môi trường trên server: **Staging để phát triển/test tích hợp** và **Production cho bản đã nghiệm thu**. Staging dùng chung database, Auth, file tài liệu và AI theo cấu hình của môi trường đó. Không bắt buộc cài PostgreSQL/Docker hoặc chạy API ở máy cá nhân cho quy trình hằng ngày này.

Máy cá nhân dùng để viết code, chạy unit/mock tests, kiểm tra kiểu dữ liệu/build và xem preview UI. Chức năng thật được thử trên bản đã deploy lên Staging. Một môi trường dev riêng được maintainer giữ lại không nằm trong phạm vi chuyển đổi này; không xoá hoặc tái sử dụng nó.

**Luồng chính:** nhánh feature local → kiểm tra local → PR vào `staging` → CI/review → merge và deploy → test thật trên Staging → nghiệm thu → PR vào `main` → pipeline Production.

| Thao tác | Có cập nhật Staging đang chạy không? |
| --- | --- |
| Lưu code hoặc commit local | Không |
| Push nhánh feature / mở PR | Không; chạy các kiểm tra CI |
| Merge vào `staging` | Kích hoạt pipeline; chỉ cập nhật khi các gate và deployment thành công |
| Merge vào `main` | Có thể kích hoạt deploy Production, không phải cách thử code |

Staging là nơi thử bản tích hợp chưa nghiệm thu; không cần chứng minh toàn bộ end-to-end trước khi đưa lên đây. Tuy nhiên, không bỏ qua kiểm tra cơ bản hoặc đưa lỗi đã biết làm hỏng môi trường chung lên để thử.

## 2. Chuẩn bị một lần

1. Cài Git, Node.js từ 24 trở lên và đúng pnpm trong trường `packageManager` của repo; tại baseline này là `pnpm@11.19.0`.
2. Clone repo Arden bằng tài khoản của chính mình. Lấy quyền GitHub và đường dẫn Staging qua kênh nội bộ được duyệt. Không cần nhận password DB để dùng giao diện Staging.
3. Mở terminal trong thư mục repo Arden và kiểm tra:

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
```

Không dùng cấu hình dev slot cũ cho Staging. Không chạy `pnpm dev:remote`, `remote:preview` hoặc `remote:status` vào các slot đã nghỉ; không đổi tên `staging` thành một slot để vượt qua kiểm tra của công cụ.

## 3. Bắt đầu công việc mới

```powershell
git status
```

Nếu có thay đổi chưa commit, dừng ở đây và xử lý trên đúng nhánh của công việc đó; không reset, clean hoặc stash tự động. Với checkout sạch, kiểm tra `origin` đúng repo Arden rồi thực hiện:

```powershell
git remote get-url origin
git fetch origin
git switch staging
git pull --ff-only origin staging
git switch -c feat/ten-chuc-nang
pnpm install --frozen-lockfile
```

Tên nhánh là ví dụ: thay bằng tên công việc riêng, dùng `feat/`, `fix/`, `docs/`… theo quy tắc repo. Nếu chưa có nhánh local `staging`, tạo nhánh theo dõi từ `origin/staging` trước khi tiếp tục. Nếu fast-forward thất bại, kiểm tra khác biệt thay vì force-push hoặc xoá lịch sử.

Đọc quy tắc và hợp đồng trên main hiện tại, đồng thời đối chiếu phần staging chưa vào main theo quy trình repo. Mỗi người làm nhánh riêng; không dùng nhánh feature của người khác làm workspace chung.

## 4. Viết code và kiểm tra trước khi commit

Chạy từ repo Arden:

```powershell
pnpm typecheck
pnpm test
pnpm test:remote
pnpm build
```

Thêm test hồi quy cho phần vừa sửa. Tests thông thường dùng unit/mock; `test:remote` kiểm tra công cụ remote bằng test fixtures, không phải yêu cầu dựng lại các dev slot.

Các bài PostgreSQL/Supabase integration có thể bị skip khi thiếu cấu hình. Ghi rõ skip, không coi là đã kiểm chứng DB. CI có các kiểm tra PostgreSQL/RLS và migration trên DB disposable của runner. Không trỏ `ARDEN_TEST_DATABASE_URL`, `ARDEN_TEST_SUPABASE_*` hoặc test reset vào dữ liệu Staging chung.

Nếu chỉ cần preview giao diện:

```powershell
pnpm dev:web
```

Mở `http://127.0.0.1:5180/?preview=1` và dùng Development preview nếu màn hình yêu cầu. Đây là UI mẫu, không phải login/lưu dữ liệu/RAG thật. Dừng bằng Ctrl+C.

Vite hiện proxy `/api`, `/auth`, `/verify` về API loopback, mặc định `127.0.0.1:3001`. Nó **không tự nối backend Staging**. Không cần chạy `pnpm db:up`; không dùng `pnpm dev` như lệnh khởi động quy trình này vì nó cũng khởi động API local.

## 5. Commit, push và PR

1. Xem `git diff`; stage từng file/hunk của công việc bằng editor hoặc `git add` với đường dẫn cụ thể. Không dùng `git add .` để gom cả secret/file không liên quan.
2. Kiểm tra phần đã stage rồi commit và push:

```powershell
git diff --cached
git commit -m "feat(knowledge): describe the completed change"
git push -u origin HEAD
```

Đổi commit message theo nội dung thật. Không commit `.env`, `.private`, key, password, dữ liệu PDF hoặc bản dump DB.

3. Tạo PR trên GitHub với **base: `staging`**, **compare: nhánh của mình**. Ghi mục đích, kết quả checks thực sự chạy, các bài skip và cách test thủ công. Nêu rõ thay đổi schema/cấu hình nếu có.
4. Đợi CI, xử lý lỗi và review theo quy tắc repo. Nếu CI chỉ lỗi trên runner, đọc job lỗi và sửa; không tắt check để merge.
5. Merge khi có quyền và đã đạt điều kiện review. Không push thẳng `staging` để bỏ qua quy trình PR.

Không đồng nhất "CI passed" với "đã deploy". Trong GitHub Actions, kiểm tra job deployment Staging thành công, rồi xác nhận revision ở `/release.json` của web Staging tương ứng bản cần thử. Nếu có người merge bản khác trong lúc mình test, ghi lại revision và kiểm tra lại phần bị ảnh hưởng.

## 6. Test chức năng thật và phối hợp dữ liệu

Test trên URL Staging do maintainer cung cấp, không phải preview local. Dùng tài khoản của chính mình, không chia sẻ session hoặc password chung.

- Đặt dữ liệu test có tiền tố nhận diện, ví dụ `TEST-TEAM-A-20261029-...`; không sửa/xoá tài liệu demo hoặc dữ liệu của người khác để làm fixture.
- Ghi nhận người test, revision đang chạy, role/tài khoản theo nhãn không nhạy cảm, bước thực hiện, kết quả mong đợi/thực tế và request ID nếu có. Không chụp token, cookie hoặc key vào báo lỗi.
- Tuỳ thay đổi, kiểm tra đăng nhập, quyền được phép/bị từ chối, note/upload, submit, Approve/Reject, indexing, Search, chat và citation đúng version/trang. Thử trạng thái lỗi/rỗng khi liên quan; không chỉ thử happy path.
- Có lỗi: sửa trên nhánh công việc, chạy lại checks, mở/cập nhật PR phù hợp rồi deploy lại qua staging. Nhánh đã merge không đồng nghĩa bản sau tự lên server nếu chưa merge PR tiếp theo.
- Dọn đúng dữ liệu test mình tạo qua chức năng được phép. Không dùng SQL reset/truncate/drop hoặc chạy suite phá dữ liệu trên Staging.

Thông báo trong kênh làm việc hiện có trước thao tác ảnh hưởng cả nhóm: migration, đổi Auth/AI, deploy có downtime, hoặc test thay đổi quyền/phòng ban dùng chung. Không giành môi trường bằng cách xoá lease hoặc khởi động dev slot cũ.

## 7. Migration, cấu hình và Production

**Migration không tự chạy theo deploy.** Một người phụ trách môi trường phối hợp kiểm tra migration trên DB disposable, lập backup/khôi phục và áp dụng đúng forward migration đã duyệt một lần. Không sửa file migration đã áp dụng, không chạy `db:migrate` từ mỗi máy vào DB chung và không gỡ schema gate khi pipeline báo cần phê duyệt.

**Cấu hình không phải code:** Google OAuth/SMTP/AI và callback/allowlist nằm trong cấu hình runtime riêng. Pipeline Core triển khai web/API, không tự bật Google hoặc áp dụng mọi cấu hình Auth/Arden-AI. Người có quyền nhập secret trực tiếp vào Coolify/secret storage; không gửi secret qua chat, GitHub hay `VITE_*`. Thay đổi Arden-AI Python phải theo workflow của repo Arden-AI, không suy ra nó được deploy bởi CI của Core.

Sau khi nghiệm thu đúng revision Staging và xác định rõ các thay đổi sẽ đi cùng, tạo PR `staging` → `main`. Merge main có thể tự kích hoạt Production; không merge để "thử trước". CI chỉ là một gate, không thay thế nghiệm thu nghiệp vụ. Nếu có phần staging chưa sẵn sàng, chưa promote toàn bộ nhánh; phối hợp phạm vi phát hành với maintainer.

## 8. Khi nào mới chạy API local với DB Staging?

Đây **chưa phải cấu hình onboarding có sẵn**. Không chỉ copy `DATABASE_URL` về máy: API còn cần Auth/origin/cookie, private file storage và có thể có worker/indexing.

Nếu DB ghi URI của PDF/note nhưng file chỉ tồn tại ở máy cá nhân, API/worker trên server sẽ không đọc được. Hai worker cấu hình sai cũng có thể cùng xử lý hoặc làm lệch trạng thái. Chỉ thực hiện sau khi maintainer chuẩn hoá kết nối SSH tunnel, quyền tối thiểu, storage và quyền sở hữu worker, rồi xác nhận tác động lên dữ liệu chung. Không mở public PostgreSQL, không dùng migration/admin credential làm runtime và không tắt kiểm tra origin/auth để chạy tạm.

## 9. Checklist trước khi báo hoàn thành

- [ ] Thay đổi có nhánh/PR riêng, không chứa secret hoặc PDF/dump dữ liệu.
- [ ] Local checks và tests liên quan có kết quả; phần skip/chưa kiểm chứng được ghi rõ.
- [ ] CI và deployment Staging đạt; đã xác nhận đúng revision để test.
- [ ] Chức năng thật và các trường hợp quyền/lỗi liên quan đã test trên Staging.
- [ ] Thay đổi DB/cấu hình được phối hợp, có phương án khôi phục thích hợp.
- [ ] Dữ liệu test được phân biệt với dữ liệu demo, không ảnh hưởng người khác.
- [ ] Chỉ promote Production sau nghiệm thu; không coi merge staging là hoàn tất sản phẩm.

## 10. Nguồn đối chiếu trong repo

File này là hướng dẫn thao tác cho nhóm Staging dùng chung, không chứa thông số kết nối. Hợp đồng chi tiết nằm ở [quy trình đóng góp](../../CONTRIBUTING.md), [release pipeline](release-pipeline.md), [operations](operations.md), [verification](rules/verification.md) và [private files](private-files.md). Tài liệu [remote development](remote-development.md) và [teammate setup](teammate-setup.md) còn giữ hướng dẫn cho slot được duyệt riêng/lịch sử, không phải đường onboarding của nhóm đã chuyển sang Staging.

Các bước được đối chiếu với source/scripts ở staging `d310f3251075da100fd98915e06a914d43328411` và main `be27d2c353ad3fc2bdd51660442e52b9df3ca7b3`. Việc tạo tài liệu không thay đổi server, cấp quyền, sửa OAuth hoặc chứng minh toàn bộ chức năng đã hoạt động. Khi manifest/workflow đổi, đọc lại lệnh và điều kiện deploy trong revision hiện tại.
