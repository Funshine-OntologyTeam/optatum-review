# optatum 리뷰 통계

옵타움 쇼핑몰(optatum.co.kr) 상품목록에 표시할 **상품별 리뷰수·평점**을 알파리뷰 API에서 집계합니다.

GitHub Actions가 **매일 새벽 4시(KST)** 자동 실행해서 결과를 GitHub Pages로 배포합니다.
사람이 정기적으로 할 일은 없습니다.

```
https://<GITHUB계정>.github.io/<리포이름>/review_stats.js
```

---

## 최초 설정 (한 번만)

### 1. 리포 생성 후 업로드

GitHub에서 리포를 만들고 이 폴더를 푸시합니다. **Public / Private 둘 다 됩니다.**
(Private 리포도 GitHub Pages는 공개로 서빙됩니다. 여기 담기는 건 리뷰 개수·평점뿐이라 공개돼도 무방합니다.)

```bash
git remote add origin https://github.com/<계정>/<리포이름>.git
git branch -M main
git push -u origin main
```

### 2. Pages 활성화

리포 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 변경.

### 3. 첫 실행

**Actions 탭 → "리뷰 통계 갱신" → Run workflow** 를 눌러 수동 실행.
완료되면 위 주소로 파일이 열리는지 확인하세요.

### 4. 쇼핑몰에 연결

카페24 스마트디자인에서 `list.html` 맨 아래 블록의 `STATS_URL` 을 3번에서 확인한 주소로 바꿉니다.
(`list_html_snippet.html` 참고)

---

## 파일

| 파일 | 역할 |
|---|---|
| `build_review_stats.js` | 알파리뷰 API 집계 → `review_stats.js` 생성 |
| `.github/workflows/update-review-stats.yml` | 매일 자동 실행 + Pages 배포 |
| `list_html_snippet.html` | 카페24 `list.html` 에 넣을 블록 |
| `ftp.config.example.json` | FTP 업로드를 쓸 경우의 설정 템플릿 (GitHub 방식에서는 불필요) |
| `run_review_stats.bat` | 로컬 PC 스케줄러용 (GitHub 방식에서는 불필요) |

## 로컬에서 직접 돌리기

```bash
node build_review_stats.js
```

11초 정도 걸리고 `review_stats.js` 가 생깁니다.

## 상품이 늘어나면

`build_review_stats.js` 의 `maxProductNo` (기본 1200) 를 올리세요.
현재 최대 상품번호는 827입니다.

## 동작 원리

알파리뷰 위젯 API 두 개를 씁니다. 인증이 필요 없는 공개 엔드포인트입니다.

- `module/review/count` — 상품번호를 콤마로 이어 붙여 리뷰 **개수**를 일괄 조회
- `meta?ratings=N` — 상품별 **별점 분포**. 이 파라미터는 `count` 에서는 무시되고 `meta` 에서만 동작합니다

평균은 분포에서 계산합니다. 별점 분포의 합계가 총 리뷰수와 일치하는지 확인했습니다.

## 주의

- 카페24 리뷰 게시판(`board_no=4`)과 숫자가 다릅니다. 게시판은 19,999건, 알파리뷰는 27,061건입니다.
  **화면에 보이는 건 알파리뷰 쪽**이라 이 스크립트도 알파리뷰를 기준으로 삼습니다.
- 알파리뷰 위젯 설정에서 리뷰를 숨기면(`review_ratings_min` 등) `meta` 에는 반영되지만
  `count` 에는 반영되지 않을 수 있습니다. 숨김 기능을 쓰기 시작하면 숫자를 다시 맞춰야 합니다.
