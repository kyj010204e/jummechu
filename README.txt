점메추 검색 신뢰도 패치 - TypeScript build fix

덮어쓸 파일:
1) C:\project\project\app\map\page.tsx
2) C:\project\project\app\map\friend\page.tsx

수정 내용:
- app/map/page.tsx Restaurant 타입에 venueType 추가
- normalizeRestaurant에서 venueType 기본값 보정
- app/map/friend/page.tsx 중복 Window.naver 전역 선언 제거
- friend NaverMapInstance에 getCenter 추가
- async loadPlaces 내부 location null narrowing 문제 해결

확인:
- 문제였던 TS2717 / TS18047 / TS2741 / TS2339 패턴을 대상으로 isolated tsc 확인 시 더 이상 검출되지 않음.
- 실제 프로젝트에서는 npm run build로 최종 확인 필요.
