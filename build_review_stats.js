/*
 * optatum.co.kr 리뷰 통계 자동 생성 + 업로드
 *
 *   node build_review_stats.js
 *
 * 1) 알파리뷰 API에서 상품별 리뷰수·평점을 집계
 * 2) review_stats.js 파일 생성
 * 3) ftp.config.json 이 있으면 카페24 /web/upload/ 로 업로드
 *
 * ftp.config.json 이 없으면 로컬 파일만 만들고 업로드는 건너뜁니다.
 * 작업 스케줄러에 run_review_stats.bat 을 등록하면 매일 자동 실행됩니다.
 */
const fs = require('fs');
const path = require('path');

const CONFIG = {
    mallId: 'optatumkorea',
    shopNo: 1,
    widgetCode: 'd65052c0',   // 알파리뷰 게시판 위젯. /sets?widget_set_code=ea0652a5 로 확인 가능
    maxProductNo: 1200,       // 상품번호 상한. 상품이 늘면 올리세요
    concurrency: 8,
    // GitHub Actions 에서는 REVIEW_STATS_OUT 환경변수로 출력 경로를 지정합니다
    outFile: process.env.REVIEW_STATS_OUT || path.join(__dirname, 'review_stats.js'),
    ftpConfig: path.join(__dirname, 'ftp.config.json'),
};

const BASE = 'https://review-widget.alphwidget.com/v2/api-widget';
const MALL = `mall_id=${CONFIG.mallId}&shop_no=${CONFIG.shopNo}`;

async function getJson(url, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) return await res.json();
        } catch (e) { /* 재시도 */ }
        await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
    return null;
}

// 1단계: 리뷰가 있는 상품 찾기 (300개씩 일괄 조회)
async function fetchCounts() {
    const counts = {};
    for (let start = 1; start <= CONFIG.maxProductNo; start += 300) {
        const ids = [];
        for (let n = start; n < start + 300 && n <= CONFIG.maxProductNo; n++) ids.push(n);
        const json = await getJson(`${BASE}/module/review/count?${MALL}&product_no=${ids.join(',')}`);
        if (!json || !json.results) continue;
        for (const [pno, cnt] of Object.entries(json.results)) if (cnt > 0) counts[pno] = cnt;
    }
    return counts;
}

// 2단계: 별점별 건수. ratings=N 필터가 /meta 에서만 동작합니다 (count 엔드포인트는 무시함)
async function fetchRatingCount(pno, rating) {
    const q = `${MALL}&widget_code=${CONFIG.widgetCode}&product_no=${pno}&page=1&page_size=10`
        + (rating ? `&ratings=${rating}` : '');
    const json = await getJson(`${BASE}/meta?${q}`);
    return json ? json.total_count : null;
}

async function fetchDistribution(pno, total) {
    // 대부분 전부 5점이라 5점부터 확인하면 요청 1번으로 끝납니다
    const five = await fetchRatingCount(pno, 5);
    if (five === null) return null;
    if (five === total) return { 5: total };

    const dist = { 5: five };
    for (let s = 4; s >= 1; s--) {
        const c = await fetchRatingCount(pno, s);
        if (c === null) return null;
        if (c) dist[s] = c;
    }
    return dist;
}

async function runPool(items, worker, concurrency) {
    let i = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (i < items.length) {
            const idx = i++;
            await worker(items[idx], idx);
        }
    }));
}

async function uploadFtp(localFile) {
    if (!fs.existsSync(CONFIG.ftpConfig)) {
        console.log('ftp.config.json 없음 → 업로드 건너뜀 (로컬 파일만 생성)');
        return false;
    }
    let ftp;
    try {
        ftp = require('basic-ftp');
    } catch (e) {
        console.error('basic-ftp 미설치. 실행: npm install basic-ftp');
        return false;
    }
    const cfg = JSON.parse(fs.readFileSync(CONFIG.ftpConfig, 'utf8'));
    const client = new ftp.Client(30000);
    try {
        await client.access({
            host: cfg.host,
            user: cfg.user,
            password: cfg.password,
            secure: cfg.secure ?? false,
        });
        await client.uploadFrom(localFile, cfg.remotePath || '/web/upload/review_stats.js');
        console.log('업로드 완료 →', cfg.remotePath);
        return true;
    } catch (e) {
        console.error('업로드 실패:', e.message);
        return false;
    } finally {
        client.close();
    }
}

(async () => {
    const started = Date.now();

    console.log('1/3 리뷰 있는 상품 조회…');
    const counts = await fetchCounts();
    const entries = Object.entries(counts).map(([p, n]) => [Number(p), n]);
    console.log(`     상품 ${entries.length}개`);

    console.log('2/3 별점 분포 조회…');
    const dist = {};
    const failed = [];
    let done = 0;
    await runPool(entries, async ([pno, total]) => {
        const d = await fetchDistribution(pno, total);
        if (d) dist[pno] = d; else failed.push(pno);
        if (++done % 50 === 0) console.log(`     ${done}/${entries.length}`);
    }, CONFIG.concurrency);

    if (failed.length) console.warn(`     실패 ${failed.length}개: ${failed.slice(0, 20).join(',')}`);

    console.log('3/3 파일 생성…');
    const out = {};
    let totalReviews = 0;
    for (const [pno, d] of Object.entries(dist)) {
        const n = Object.values(d).reduce((a, b) => a + b, 0);
        const sum = Object.entries(d).reduce((a, [s, c]) => a + Number(s) * c, 0);
        totalReviews += n;
        out[pno] = [n, Number((sum / n).toFixed(1))];
    }

    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const body = `/* optatum.co.kr 상품별 리뷰 통계 (알파리뷰 API)\n`
        + ` * 생성: ${stamp} UTC\n`
        + ` * 리뷰 ${totalReviews}건 / 상품 ${Object.keys(out).length}개\n`
        + ` * 형식: "상품번호": [리뷰수, 평점평균] */\n`
        + `window.REVIEW_STATS=${JSON.stringify(out)};\n`;

    fs.mkdirSync(path.dirname(CONFIG.outFile), { recursive: true });
    fs.writeFileSync(CONFIG.outFile, body, 'utf8');
    console.log(`     ${CONFIG.outFile} (${(body.length / 1024).toFixed(1)}KB)`);
    console.log(`     리뷰 ${totalReviews}건 / 상품 ${Object.keys(out).length}개`);

    await uploadFtp(CONFIG.outFile);

    console.log(`끝. ${((Date.now() - started) / 1000).toFixed(0)}초`);
})();
