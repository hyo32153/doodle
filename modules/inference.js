import { setErrorStatus, setReadyStatus } from "./ui.js";

// 모델 파일을 비동기로 로드하고, 성공/실패 상태를 상태바에 반영한다.
// 성공 시 state.model에 tf.LayersModel 인스턴스를 저장한다.
export async function loadModel(state, modelUrl, statusEl) {
  try {
    state.model = await tf.loadLayersModel(modelUrl);
    setReadyStatus(statusEl);
  } catch (err) {
    setErrorStatus(statusEl, err.message);
    console.error("Model load error:", err);
  }
}

// 예측 호출을 디바운스한다.
// 기존 타이머가 있으면 취소하고 새 타이머를 등록해 마지막 호출만 실행되게 한다.
export function schedulePrediction(state, predict, debounceMs) {
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(predict, debounceMs);
}

// 전체 추론 파이프라인:
// 1) 입력 유효성 검사(모델/획)
// 2) 전처리 함수로 입력 텐서 생성
// 3) 모델 추론 및 확률 정렬
// 4) 상위 K개 결과를 UI 렌더러에 전달
export async function predict(state, deps) {
  const { classes, topK, getInputTensor, renderPredictions } = deps;
  if (!state.model) return;

  if (state.strokes.length === 0) {
    renderPredictions([]);
    return;
  }

  const inputTensor = getInputTensor(state.strokes);
  if (!inputTensor) {
    renderPredictions([]);
    return;
  }

  const outputTensor = state.model.predict(inputTensor);
  const probabilities = await outputTensor.data();

  // 텐서를 즉시 해제해 메모리 누수를 방지한다.
  inputTensor.dispose();
  outputTensor.dispose();

  // 각 확률에 원래 클래스 인덱스를 붙여 정렬 가능한 형태로 변환
  const indexed = Array.from(probabilities).map((prob, idx) => ({ idx, prob }));
  indexed.sort((a, b) => b.prob - a.prob);

  // 화면 표기용으로 클래스명의 밑줄(_)을 공백으로 바꿔 가독성을 높인다.
  const topPredictions = indexed.slice(0, topK).map((item) => ({
    className: classes[item.idx].replace(/_/g, " "),
    confidence: item.prob,
  }));

  renderPredictions(topPredictions);
}
