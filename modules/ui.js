// 예측 결과 목록을 HTML로 렌더링한다.
// predictions 형식: [{ className: string, confidence: number }, ...]
export function renderPredictions(predictionsEl, predictions) {
  // 결과가 없으면 플레이스홀더 문구를 노출
  if (predictions.length === 0) {
    predictionsEl.innerHTML =
      '<p class="placeholder-text">Draw something to start...</p>';
    return;
  }

  predictionsEl.innerHTML = predictions
    .map((p) => {
      // confidence(0~1)를 퍼센트(0~100)로 변환해 표시
      const pct = (p.confidence * 100).toFixed(1);
      return `
      <div class="prediction-item">
        <div class="label-row">
          <span class="class-name">${p.className}</span>
          <span class="confidence">${pct}%</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
    })
    .join("");
}

// 모델 로딩 성공 상태를 상태바에 반영
export function setReadyStatus(statusEl) {
  statusEl.textContent = "Model ready - start drawing!";
  statusEl.className = "status-bar ready";
}

// 모델 로딩 실패 상태를 상태바에 반영
export function setErrorStatus(statusEl, message) {
  statusEl.textContent = `Failed to load model: ${message}`;
  statusEl.className = "status-bar error";
}
