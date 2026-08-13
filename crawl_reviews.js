/*
 * optatum.co.kr 상품별 리뷰 집계 — 알파리뷰(AlphaReview) API 기준
 *
 * 이 쇼핑몰의 실제 리뷰는 카페24 게시판이 아니라 알파리뷰가 관리합니다.
 * 상품 상세에 노출되는 숫자와 100% 일치합니다.
 *
 * 사용법
 *  1. https://optatum.co.kr 아무 페이지나 열고 F12 > Console
 *  2. 이 파일 전체를 붙여넣고 실행
 *  3. 1~2분 뒤 review_stats.js 파일이 자동 다운로드됨
 *  4. 그 안의 { ... } 부분을 list.html 의 REVIEW_STATS 값에 덮어쓰기
 *
 * 결과 포맷: { "<product_no>": [리뷰수, 평점평균], ... }
 */
(async () => {
    const BASE = 'https://review-widget.alphwidget.com/v2/api-widget';
    const MALL = 'mall_id=optatumkorea&shop_no=1';
    const WIDGET = 'd65052c0';   // 알파리뷰 게시판 위젯 코드 (/sets?widget_set_code=ea0652a5 로 확인)
    const MAX_PRODUCT_NO = 1200; // 상품번호 상한. 상품이 늘면 올리세요
    const CONCURRENCY = 8;

    // 1단계: 리뷰가 있는 상품 찾기 (한 번에 300개씩 조회 가능)
    const counts = {};
    for (let s = 1; s <= MAX_PRODUCT_NO; s += 300) {
        const ids = [];
        for (let i = s; i < s + 300 && i <= MAX_PRODUCT_NO; i++) ids.push(i);
        const res = await fetch(`${BASE}/module/review/count?${MALL}&product_no=${ids.join(',')}`);
        if (!res.ok) continue;
        const { results } = await res.json();
        Object.entries(results).forEach(([k, v]) => { if (v > 0) counts[k] = v; });
    }
    console.log(`리뷰 있는 상품 ${Object.keys(counts).length}개`);

    // 2단계: 별점별 개수 조회. ratings=N 으로 필터하면 해당 별점 건수만 돌아옵니다
    const meta = async (pno, rating) => {
        const q = `${MALL}&widget_code=${WIDGET}&product_no=${pno}&page=1&page_size=10`
            + (rating ? `&ratings=${rating}` : '');
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const r = await fetch(`${BASE}/meta?${q}`);
                if (r.ok) return (await r.json()).total_count;
            } catch (e) { /* 재시도 */ }
        }
        return null;
    };

    const dist = {};
    const one = async (pno, total) => {
        // 대부분 전부 5점이라 5점부터 확인하면 요청 1번으로 끝납니다
        const five = await meta(pno, 5);
        if (five === null) return;
        if (five === total) { dist[pno] = { 5: total }; return; }
        const d = { 5: five };
        for (let s = 4; s >= 1; s--) {
            const c = await meta(pno, s);
            if (c === null) return;
            if (c) d[s] = c;
        }
        dist[pno] = d;
    };

    const queue = Object.entries(counts);
    let i = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (i < queue.length) {
            const [pno, total] = queue[i++];
            await one(pno, total);
            if (i % 50 === 0) console.log(`${i}/${queue.length}`);
        }
    }));

    // 3단계: 평균 계산
    const out = {};
    let totalReviews = 0;
    Object.entries(dist).forEach(([pno, d]) => {
        const n = Object.values(d).reduce((a, b) => a + b, 0);
        const sum = Object.entries(d).reduce((a, [s, c]) => a + s * c, 0);
        totalReviews += n;
        out[pno] = [n, +(sum / n).toFixed(1)];
    });

    console.log(`완료: 리뷰 ${totalReviews}건 / 상품 ${Object.keys(out).length}개`);

    const header = '/* optatum.co.kr 상품별 리뷰 실측 데이터 (알파리뷰 API 기준)\n'
        + ' * 형식: "상품번호": [리뷰수, 평점평균]\n'
        + ` * 집계: 리뷰 ${totalReviews}건 / 상품 ${Object.keys(out).length}개 */\n`;
    const blob = new Blob([header + 'window.REVIEW_STATS=' + JSON.stringify(out) + ';\n'],
        { type: 'application/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'review_stats.js';
    a.click();

    return out;
})();
