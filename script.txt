document.addEventListener('DOMContentLoaded', () => {
    const peakInput = document.getElementById('peakInput');
    const detectButton = document.getElementById('detectButton');
    const detectionResult = document.getElementById('detectionResult');
    const statusImage = document.getElementById('statusImage');
    const systemStatusText = document.getElementById('systemStatusText');

    // 定义重金属及其特征峰和基础浓度关系
    // 这里的浓度计算是简化的，实际应用中会复杂得多，需要校准曲线
    const heavyMetals = {
        '铅 (Pb)': { peak: -0.6, range: 0.1, baseConcentration: 0.1 }, // 估算自 Pb.png
        '镉 (Cd)': { peak: -0.85, range: 0.1, baseConcentration: 0.05 }, // 估算自 Cd.png
        '铁 (Fe)': { peak: -0.2, range: 0.15, baseConcentration: 0.08 }, // 估算自 Fe.png
        '铜 (Cu)': { peak: -0.3, range: 0.1, baseConcentration: 0.09 }, // 估算自 Cu.png
        '锌 (Zn)': { peak: -1.0, range: 0.1, baseConcentration: 0.06 }, // 估算自 Zn.png
        // 你可以根据实际数据添加或调整
    };

    // 默认的图片路径 (安全状态)
    const safeImagePath = 'images/safe.png';
    // 警报状态的图片路径
    const alertImagePath = 'images/alert.png';

    // 初始化图片和文本
    statusImage.src = safeImagePath;
    statusImage.classList.add('safe-state');
    systemStatusText.textContent = '系统正在运行，等待输入...';

    detectButton.addEventListener('click', () => {
        const inputPeaks = peakInput.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
        
        if (inputPeaks.length === 0) {
            detectionResult.innerHTML = '<p class="safe">请输入有效的信号峰值。</p>';
            // 保持安全状态图片和文本
            statusImage.src = safeImagePath;
            statusImage.classList.remove('alert-state');
            statusImage.classList.add('safe-state');
            systemStatusText.textContent = '系统正在运行，等待输入...';
            return;
        }

        let foundMetals = [];
        let hasAlert = false;

        inputPeaks.forEach(currentPeak => {
            for (const metalName in heavyMetals) {
                const metalInfo = heavyMetals[metalName];
                const lowerBound = metalInfo.peak - metalInfo.range;
                const upperBound = metalInfo.peak + metalInfo.range;

                if (currentPeak >= lowerBound && currentPeak <= upperBound) {
                    // 假设浓度与峰值偏离特征峰的程度有关，这里是一个非常简化的模型
                    // 实际中需要复杂的校准曲线和计算
                    let concentrationFactor = Math.abs(currentPeak - metalInfo.peak) / metalInfo.range;
                    concentrationFactor = Math.max(0, 1 - concentrationFactor); // 峰值越接近特征峰，因子越高
                    
                    const estimatedConcentration = (metalInfo.baseConcentration * (1 + concentrationFactor)).toFixed(3);
                    
                    foundMetals.push({
                        name: metalName,
                        peak: currentPeak,
                        concentration: estimatedConcentration
                    });
                    hasAlert = true;
                }
            }
        });

        // 根据检测结果更新网页内容
        if (foundMetals.length > 0) {
            let resultHtml = '<h3>检测到重金属！</h3>';
            foundMetals.forEach(metal => {
                resultHtml += `<p class="alert">检测到 **${metal.name}**，信号峰值为 **${metal.peak} V**，浓度约为 **${metal.concentration} μg/L**。</p>`;
            });
            detectionResult.innerHTML = resultHtml;

            // 更新图片为警报状态
            statusImage.src = alertImagePath;
            statusImage.classList.remove('safe-state');
            statusImage.classList.add('alert-state');
            systemStatusText.textContent = '检测到重金属！请注意！';

        } else {
            detectionResult.innerHTML = '<p class="safe">未检测到匹配的重金属信号。</p>';
            
            // 更新图片为安全状态
            statusImage.src = safeImagePath;
            statusImage.classList.remove('alert-state');
            statusImage.classList.add('safe-state');
            systemStatusText.textContent = '系统正常，环境安全。';
        }
    });
});