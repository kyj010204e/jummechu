점메추 최종 추천 학습 패치

포함 기능
1) 취향 탐험 주변 가게 보강
   - 탐험 후보 24개까지 생성
   - 5km 우선
   - 부족하면 8km 확장
   - 메뉴명 표기 동의어/food type/family 보조 검색
   - 한 번의 탐험에서 위치 검색 최대 24회
   - 실제 주변 식당이 확인된 메뉴만 표시

2) 사용자 평가 기반 취향 학습
   - 탐험 메뉴 카드에 👍 좋았어요 / 👎 별로였어요
   - recommendation_feedback 테이블에 사용자별 메뉴 평가 저장
   - 좋아요 +0.85 / 별로예요 -0.65 가중치로 taste embedding 재생성
   - 현재 벡터에 계속 누적하는 방식이 아니라 기본 선호 + 전체 피드백에서 다시 계산
   - 사용자가 선호도 화면에서 직접 선택한 메뉴는 과거 피드백보다 우선
   - 갱신된 user_taste_embeddings를 개인 추천/친구 추천이 함께 사용
   - 이미 평가한 메뉴는 이후 취향 탐험의 '새 메뉴'에서 제외

파일
app/api/exploration/route.ts
app/api/recommendation-feedback/route.ts
app/api/preferences/route.ts
components/ExplorationPanel.tsx
lib/taste-feedback.ts
database/recommendation_feedback_v1.sql

DB
recommendation-feedback API가 처음 호출될 때 테이블을 자동 생성합니다.
database/recommendation_feedback_v1.sql은 수동으로 미리 생성하고 싶을 때 사용할 수 있습니다.
