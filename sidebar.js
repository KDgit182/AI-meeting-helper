// 配置信息
const CONFIG = {
  API_ENDPOINT: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', // 默认使用通义千问
  MODEL_NAME: 'qwen-plus-latest',  // 默认使用通义千问模型
  MAX_CONTEXT_LENGTH: 500
};

// 状态管理
let recognition;
let transcriptBuffer = '';
let isAnalyzing = false;
let isRecognizing = false;
let persona_position = ''; // 新增人设变量

// 初始化语音识别
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    updateStatus('recognitionStatus', '❌ 浏览器不支持语音识别', 'error');
    return null;
  }

  const recognizer = new SpeechRecognition();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = 'zh-CN';

  recognizer.onstart = () => {
    isRecognizing = true;
    updateStatus('recognitionStatus', '🟢 正在收听...', 'success');
  };

  recognizer.onend = () => {
    isRecognizing = false;
    if (!isAnalyzing) {
      updateStatus('recognitionStatus', '🔴 已停止', 'error');
    }
  };

  recognizer.onresult = (event) => {
    const results = Array.from(event.results)
      .map(result => result[0].transcript)
      .join(' ');
    
    transcriptBuffer = results.slice(-CONFIG.MAX_CONTEXT_LENGTH);
    updateTranscript(transcriptBuffer);
  };

  recognizer.onerror = (event) => {
    updateStatus('recognitionStatus', `❌ 识别错误: ${event.error}`, 'error');
  };

  return recognizer;
}

// 更新状态显示
function updateStatus(elementId, text, type) {
  const element = document.getElementById(elementId);
  element.textContent = text;
  element.style.color = type === 'error' ? '#f44336' : '#4CAF50';
}

// 更新实时转录
function updateTranscript(text) {
  const display = document.getElementById('realTimeText');
  display.textContent = text;
  display.scrollTop = display.scrollHeight;
}

// 调用LLM API
async function callLLM(prompt) {
  const result = await chrome.storage.local.get('apiKey');
  const apiKey = result.apiKey;
  
  if (!apiKey) {
    updateStatus('analysisStatus', '❌ 请先配置API密钥', 'error');
    return;
  }

  try {
    updateStatus('analysisStatus', '🟡 正在连接API...', 'warning');
    
    const response = await fetch(CONFIG.API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: CONFIG.MODEL_NAME,
        messages: [{ role: "user", content: prompt }],
        stream: true,
        enable_thinking: false
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const message = line.replace(/^data: /, '');
        if (message === '[DONE]') break;
        
        try {
          const parsed = JSON.parse(message);
          if (parsed.choices[0].delta.content) {
            fullResponse += parsed.choices[0].delta.content;
            showAnalysisResult(fullResponse);  // 实时更新显示
          }
        } catch (e) {
          console.error('解析错误:', e);
        }
      }
    }

    updateStatus('analysisStatus', '🟢 分析完成', 'success');
  } catch (error) {
    console.error('API调用失败:', error);
    updateStatus('analysisStatus', `❌ 错误: ${error.message}`, 'error');
    showAnalysisResult(`⚠️ 请求失败，请检查：\n1. API密钥有效性\n2. 网络连接`);
  } finally {
    isAnalyzing = false;
  }
}

// 显示分析结果
function showAnalysisResult(text) {
  const resultDiv = document.getElementById('analysisResult');
  resultDiv.innerHTML = text;
  resultDiv.scrollTop = resultDiv.scrollHeight;
}

// 保存人设
function savePersona() {
  persona_position = document.getElementById('personaInput').value.trim();
  if (persona_position) {
    chrome.storage.local.set({ persona_position });
    updateStatus('recognitionStatus', '🟢 人设已保存', 'success');
  } else {
    updateStatus('recognitionStatus', '❌ 人设不能为空', 'error');
  }
}

// 加载保存的人设
async function loadPersona() {
  const result = await chrome.storage.local.get('persona_position');
  if (result.persona_position) {
    persona_position = result.persona_position;
    document.getElementById('personaInput').value = persona_position;
  }
}

// 事件监听
document.addEventListener('DOMContentLoaded', async () => {
  // 加载保存的API密钥
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
  }

  // 初始化语音识别
  recognition = initSpeechRecognition();

  // 加载保存的人设
  await loadPersona();

  // 按钮事件
  document.getElementById('startRecognition').addEventListener('click', async () => {
    if (!recognition) return;
    
    if (isRecognizing) {
      recognition.stop();
      document.getElementById('analyze').disabled = true;
    } else {
      try {
        // 请求麦克风权限
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop()); // 立即停止流，我们只需要权限
        
        recognition.start();
        document.getElementById('analyze').disabled = false;
      } catch (error) {
        updateStatus('recognitionStatus', '❌ 无法访问麦克风，请检查权限设置', 'error');
      }
    }
  });

  document.getElementById('analyze').addEventListener('click', () => {
    if (isAnalyzing || !transcriptBuffer) return;
    
    isAnalyzing = true;
    // 当用户点击"为我发声"时，是否需要强行停止实时语音转录？ 
    //    if (isRecognizing) {
    //      recognition.stop();
    //      updateStatus('recognitionStatus', '🔴 已停止', 'error');
    //    }
    
    const prompt = `当前会议讨论内容：${transcriptBuffer}\n请作为${persona_position || '一个专业的会议参与者'}的角色人设简短发言，及时救场。参考发言模板为关键词提醒+展开发言。如【关键词A】【关键词B】【关键词C】发言内容：`;
    callLLM(prompt);
  });

  document.getElementById('saveKey').addEventListener('click', () => {
    const key = document.getElementById('apiKey').value.trim();
    if (!key) return;
    
    chrome.storage.local.set({ apiKey: key });
    alert('API密钥已保存');
  });

  // 添加保存人设按钮事件
  document.getElementById('savePersona').addEventListener('click', savePersona);
});