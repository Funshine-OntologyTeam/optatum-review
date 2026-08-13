@echo off
REM optatum.co.kr 리뷰 통계 갱신 + 업로드
REM 작업 스케줄러에 이 파일을 등록하면 매일 자동 실행됩니다.

cd /d "%~dp0"
node build_review_stats.js >> review_stats.log 2>&1
exit /b %ERRORLEVEL%
