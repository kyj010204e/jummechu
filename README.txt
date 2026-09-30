점메추 - 먹어보기 / 히스토리 / 재방문 감점 패치

적용 위치: C:\project\project

추가/수정 파일
- app/map/page.tsx
- components/ExplorationPanel.tsx
- components/MealTryModal.tsx
- app/api/meal-history/route.ts
- app/api/meal-history/[id]/route.ts
- app/meal-history/page.tsx
- lib/meal-history.ts
- database/meal_history_v1.sql

동작
1) 일반 추천 카드
   - '🍽️ 먹어보기' 버튼
   - 카드 더블클릭으로도 동일 동작
   - 먹어본 가게는 일반 추천 점수가 방문 1회당 4점씩 감소, 최대 16점 감점
   - 카드에 '먹어본 곳 N회 · 추천 -N' 표시

2) 취향 탐험
   - '🍽️ 먹어보기' 버튼 + 카드 더블클릭
   - 먹어보기 히스토리에 이미 존재하는 가게는 탐험 후보에서 제외
   - 기존 카드의 즉시 좋아요/싫어요는 제거하고 먹어보기 후 평가 흐름으로 통일

3) 먹어보기 히스토리
   - /meal-history
   - 모든 먹어보기 기록 저장
   - 일반추천 / 취향탐험 출처 표시
   - 👍 좋았어요 / 👎 별로였어요 평가 가능
   - 평가 시 기존 recommendation_feedback + user_taste_embeddings 학습 로직 재사용

DB
- API가 meal_history 테이블을 자동 생성하므로 별도 SQL 실행은 필수가 아닙니다.
- database/meal_history_v1.sql은 수동 생성/문서화용입니다.

주의
- 기존 recommendation_feedback / lib/taste-feedback.ts가 이미 적용된 현재 프로젝트 기준입니다.
