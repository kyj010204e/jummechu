점메추 production build TypeScript 수정

덮어쓰기 위치:
- app/api/preferences/route.ts
- app/map/page.tsx
- app/map/friend/page.tsx

수정 내용:
1. preferences Set literal union 타입 오류 수정
2. Restaurant 타입에 venueType/venueTypeLabel 추가
3. friend map의 중복 Window.naver 선언 제거
4. friend map Naver 타입 호환성 보정
5. 비동기 음식점 요청에서 location null narrowing 보정

적용 후:
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
