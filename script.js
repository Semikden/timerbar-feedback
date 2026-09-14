/* ================================================================
   Timer Bar Feedback — клиентская логика
   - Валидация полей
   - Подсчёт символов
   - Отправка через настраиваемый backend (см. config.json)
   ================================================================ */

(function () {
  'use strict';

  // ====== CONFIG ====================================================
  // Если хочется подключить свой backend — замените endpoint.
  // По умолчанию используется относительный путь (для статик-хостинга
  // рядом с serverless-функцией). Если поля нет — будет fallback
  // на mailto: (показываем гостю собранное письмо).
  const CONFIG = window.FEEDBACK_CONFIG || {
    endpoint: '',          // например: '/api/feedback' или 'https://form.timerbar.ru/api/feedback'
    fallbackToMailto: true,
    fallbackEmail: 'owner@timerbar.ru',
    // channel: 'telegram' | 'email' | 'sheets' — определяется на сервере
  };

  // ====== DOM ========================================================
  const form = document.getElementById('feedbackForm');
  const submitBtn = document.getElementById('submitBtn');
  const successScreen = document.getElementById('success');
  const newMessageBtn = document.getElementById('newMessageBtn');
  const counter = document.getElementById('counter');
  const messageEl = document.getElementById('message');

  const TYPE_LABEL = {
    complaint: 'Жалоба',
    suggestion: 'Предложение',
    gratitude: 'Благодарность',
    question: 'Вопрос',
  };

  // ====== HELPERS ====================================================
  function fieldEl(name) {
    return form.querySelector(`[name="${name}"]`);
  }
  function errorEl(name) {
    return form.querySelector(`[data-error-for="${name}"]`);
  }
  function fieldWrap(name) {
    return fieldEl(name).closest('.field');
  }
  function setError(name, message) {
    const wrap = fieldWrap(name);
    const err = errorEl(name);
    if (message) {
      wrap.classList.add('has-error');
      err.textContent = message;
    } else {
      wrap.classList.remove('has-error');
      err.textContent = '';
    }
  }
  function clearAllErrors() {
    form.querySelectorAll('.field').forEach((f) => f.classList.remove('has-error'));
    form.querySelectorAll('.field__error').forEach((e) => (e.textContent = ''));
  }

  // ====== VALIDATION =================================================
  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }
  function isPhone(v) {
    // Разрешаем +7, 8, цифры, пробелы, скобки, дефисы. Минимум 10 цифр.
    const digits = v.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15 && /^[+\d\s()\-]+$/.test(v);
  }
  function isValidContact(v) {
    return isEmail(v) || isPhone(v);
  }

  function validateField(name) {
    const el = fieldEl(name);
    const v = (el.value || '').trim();

    if (name === 'name') {
      if (!v) return setError(name, 'Укажите имя'), false;
      if (v.length < 2) return setError(name, 'Слишком короткое имя'), false;
      return setError(name, ''), true;
    }

    if (name === 'contact') {
      if (!v) return setError(name, 'Укажите телефон или email'), false;
      if (!isValidContact(v))
        return setError(name, 'Похоже на опечатку. Пример: +7 999 000-00-00 или you@example.com'), false;
      return setError(name, ''), true;
    }

    if (name === 'type') {
      if (!v) return setError(name, 'Выберите тип обращения'), false;
      return setError(name, ''), true;
    }

    if (name === 'message') {
      if (!v) return setError(name, 'Опишите ситуацию'), false;
      if (v.length < 10) return setError(name, 'Минимум 10 символов'), false;
      return setError(name, ''), true;
    }

    return true;
  }

  function validateAll() {
    let ok = true;
    ['name', 'contact', 'type', 'message'].forEach((n) => {
      if (!validateField(n)) ok = false;
    });
    return ok;
  }

  // ====== LIVE COUNTER ===============================================
  function updateCounter() {
    const len = (messageEl.value || '').length;
    counter.textContent = len;
    counter.style.color = len > 1800 ? 'var(--accent)' : '';
  }

  // ====== SUBMIT =====================================================
  function buildPayload() {
    const data = {
      name: fieldEl('name').value.trim(),
      contact: fieldEl('contact').value.trim(),
      type: fieldEl('type').value,
      typeLabel: TYPE_LABEL[fieldEl('type').value] || fieldEl('type').value,
      message: fieldEl('message').value.trim(),
      createdAt: new Date().toISOString(),
      source: {
        url: location.href,
        referrer: document.referrer || null,
        ua: navigator.userAgent,
        lang: navigator.language,
      },
    };
    return data;
  }

  function setLoading(state) {
    if (state) {
      submitBtn.classList.add('is-loading');
      submitBtn.disabled = true;
    } else {
      submitBtn.classList.remove('is-loading');
      submitBtn.disabled = false;
    }
  }

  function showSuccess() {
    form.hidden = true;
    successScreen.hidden = false;
    successScreen.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetForm() {
    form.reset();
    clearAllErrors();
    updateCounter();
    form.hidden = false;
    successScreen.hidden = true;
    fieldEl('name').focus();
  }

  function fallbackToMailto(payload) {
    const subject = encodeURIComponent(`[${payload.typeLabel}] Timer Bar — обращение`);
    const body = encodeURIComponent(
      `Тип: ${payload.typeLabel}\n` +
      `Имя: ${payload.name}\n` +
      `Контакт: ${payload.contact}\n` +
      `Дата: ${new Date(payload.createdAt).toLocaleString('ru-RU')}\n\n` +
      `Сообщение:\n${payload.message}\n`
    );
    location.href = `mailto:${CONFIG.fallbackEmail}?subject=${subject}&body=${body}`;
  }

  async function send(payload) {
    if (!CONFIG.endpoint) {
      // Нет настроенного backend — fallback на mailto
      if (CONFIG.fallbackToMailto) {
        fallbackToMailto(payload);
        return { ok: true, channel: 'mailto' };
      }
      throw new Error('Не настроен endpoint для отправки');
    }

    const res = await fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Сервер вернул ${res.status}`);
    }
    return res.json().catch(() => ({ ok: true }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearAllErrors();
    if (!validateAll()) {
      // Фокус на первое поле с ошибкой
      const firstError = form.querySelector('.field.has-error input, .field.has-error select, .field.has-error textarea');
      if (firstError) firstError.focus();
      return;
    }

    const payload = buildPayload();
    setLoading(true);

    try {
      const result = await send(payload);
      // Если mailto — не показываем success, пользователь уходит в почтовый клиент
      if (result && result.channel === 'mailto') {
        // небольшая задержка чтобы успела сработать mailto
        setTimeout(showSuccess, 600);
      } else {
        showSuccess();
      }
    } catch (err) {
      console.error('Submit error:', err);
      // Покажем общую ошибку на submit
      const submitErr = form.querySelector('.submit + .legal') || form.querySelector('.legal');
      if (submitErr) {
        submitErr.textContent =
          'Не удалось отправить. Попробуйте ещё раз или позвоните: +7 918 499-01-01';
        submitErr.style.color = 'var(--error)';
      }
    } finally {
      setLoading(false);
    }
  }

  // ====== EVENTS =====================================================
  ['name', 'contact', 'type', 'message'].forEach((n) => {
    fieldEl(n).addEventListener('blur', () => {
      if (fieldEl(n).value.trim()) validateField(n);
    });
    fieldEl(n).addEventListener('input', () => setError(n, ''));
  });

  messageEl.addEventListener('input', updateCounter);

  form.addEventListener('submit', onSubmit);
  newMessageBtn.addEventListener('click', resetForm);

  // ====== INIT =======================================================
  updateCounter();
  fieldEl('name').focus();
})();