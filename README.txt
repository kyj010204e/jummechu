점메추 - 먹어보기 저장 방식 + 삭제 + 개인 코멘트 패치

적용 위치:
C:\project\project

포함 파일:
- components/MealTryModal.tsx
- components/ExplorationPanel.tsx
- app/map/page.tsx
- app/meal-history/page.tsx
- app/api/meal-history/route.ts
- app/api/meal-history/[id]/route.ts
- lib/meal-history.ts
- database/meal_history_v1.sql

변경사항:
1. 먹어보기 모달을 여는 것만으로는 기록하지 않음
2. '저장하기'를 눌러야 meal_history 생성
3. 좋아요/싫어요는 저장 시 같이 기록하거나 히스토리에서 나중에 평가 가능
4. 사용자 본인만 보는 private_comment 추가 (최대 1000자)
5. 히스토리에서 개인 메모 수정/저장 가능
6. 히스토리 삭제 가능
7. 평가된 기록 삭제 시 남은 식사 평가를 기준으로 추천 피드백/취향 embedding 재계산
8. 기존 meal_history 테이블은 API가 private_comment/updated_at 컬럼을 자동 추가

적용 후:
cd C:\project\project
npm run build
