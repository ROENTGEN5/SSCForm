/**
 * SSC Google Forms Style Survey & Certificate Web Application
 * - Dark Mode by default with Google Forms visual language
 * - Dynamic form builder (Title, description, question types, inline choices, duplicate, delete)
 * - Automatic JSON question import & export
 * - Customizable Certificate with PDF/Image template upload & live overlay positioning
 * - On-demand lazy-loaded pdf-lib / html2pdf engine, Postgres 23505 duplicate handling
 */

import { createClient } from '@supabase/supabase-js';

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Configuration & Default In-Memory Store
  // ---------------------------------------------------------------------------
  const APP_CONFIG = __APP_CONFIG__;
  const DEFAULT_SUPABASE_URL = APP_CONFIG.url;
  const DEFAULT_SUPABASE_ANON_KEY = APP_CONFIG.key;

  let supabaseClient = null;
  let isDemoMode = false;
  let isAdminMode = false;

  const demoStore = {
    formSettings: {
      id: 1,
      form_title: "Participant Feedback & Summit Survey",
      form_description: "Please complete this feedback form to help us evaluate the summit sessions and quality. Upon submission, your official Certificate of Completion will be generated immediately.",
      theme_color: "#7c3aed"
    },
    questions: [
      {
        id: "demo-q1",
        question_text: "How would you rate the overall summit experience?",
        question_type: "rating",
        options: [],
        is_required: true,
        sort_order: 1
      },
      {
        id: "demo-q2",
        question_text: "Which session tracks did you attend today?",
        question_type: "choice",
        options: ["Keynote & Opening Plenary", "Technical Deep Dives", "Hands-on Workshops", "Networking Lounge"],
        is_required: true,
        sort_order: 2
      },
      {
        id: "demo-q3",
        question_text: "How likely are you to attend our next edition?",
        question_type: "rating",
        options: [],
        is_required: true,
        sort_order: 3
      },
      {
        id: "demo-q4",
        question_text: "What topics or key takeaways would you like to see covered next time?",
        question_type: "paragraph",
        options: [],
        is_required: false,
        sort_order: 4
      }
    ],
    responses: [
      {
        id: "demo-resp-1",
        full_name: "Alex Rivera",
        email: "alex.rivera@example.com",
        answers: {
          "How would you rate the overall summit experience?": "5",
          "Which session tracks did you attend today?": "Technical Deep Dives",
          "How likely are you to attend our next edition?": "5",
          "What topics or key takeaways would you like to see covered next time?": "More real-world system architecture breakdowns!"
        },
        created_at: new Date(Date.now() - 3600000).toISOString()
      }
    ],
    certificateSettings: {
      id: 1,
      title: "Certificate of Completion",
      issuer: "PUP Unisan Supreme Student Council",
      body: "This certificate is proudly awarded to {name} in recognition of active participation, survey completion, and contributions to the technical sessions.",
      signatory_name: "Authorized SSC Signatory",
      signatory_title: "Supreme Student Council",
      template_type: "default", // 'default' or 'custom_pdf' or 'custom_image'
      template_data: "",
      template_filename: "",
      name_y_percent: 52,
      name_font_size: 32,
      name_color: "#1e3a8a",
      name_font_family: "serif"
    }
  };

  // State
  let formSettings = { ...demoStore.formSettings };
  let currentQuestions = [];
  let certSettings = { ...demoStore.certificateSettings };
  let participantAnswers = {};
  let activeParticipant = { name: "", email: "" };
  let cachedResponses = [];
  let currentUser = null;
  let dataReady = false;
  let submitting = false;

  // DOM References
  const viewParticipant = document.getElementById('view-participant');
  const viewCertificate = document.getElementById('view-certificate');
  const viewAdmin = document.getElementById('view-admin');

  // Navbar
  const navFormTitle = document.getElementById('nav-form-title');
  const adminTabsNav = document.getElementById('admin-tabs-nav');
  const btnOpenSendModal = document.getElementById('btn-open-send-modal');
  const btnTogglePreview = document.getElementById('btn-toggle-preview');
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  const themeIcon = document.getElementById('theme-icon');

  // Participant Form
  const publicFormTitle = document.getElementById('public-form-title');
  const publicFormDesc = document.getElementById('public-form-desc');
  const participantSurveyForm = document.getElementById('participant-survey-form');
  const inputPName = document.getElementById('input-p-name');
  const inputPEmail = document.getElementById('input-p-email');
  const cardPName = document.getElementById('card-p-name');
  const cardPEmail = document.getElementById('card-p-email');
  const participantDynamicQuestions = document.getElementById('participant-dynamic-questions');
  const participantAlertBox = document.getElementById('participant-alert-box');
  const btnSubmitForm = document.getElementById('btn-submit-form');
  const btnClearForm = document.getElementById('btn-clear-form');

  // Certificate Display Elements
  const certificatePrintArea = document.getElementById('certificate-print-area');
  // Keep the certificate's landscape layout readable on narrow screens.
  new ResizeObserver(([entry]) => {
    certificatePrintArea.style.zoom = Math.min(1, entry.contentRect.width / 580);
  }).observe(certificatePrintArea.parentElement);
  const certificateCustomArea = document.getElementById('certificate-custom-area');
  const customCertNameDisplay = document.getElementById('custom-cert-name-display');

  const certTitleDisplay = document.getElementById('cert-title-display');
  const certIssuerDisplay = document.getElementById('cert-issuer-display');
  const certRecipientName = document.getElementById('cert-recipient-name');
  const certBodyDisplay = document.getElementById('cert-body-display');
  const certSigScript = document.getElementById('cert-sig-script');
  const certSigNameDisplay = document.getElementById('cert-sig-name-display');
  const certSigTitleDisplay = document.getElementById('cert-sig-title-display');
  const certDateDisplay = document.getElementById('cert-date-display');
  const certIdDisplay = document.getElementById('cert-id-display');
  const btnDownloadPdf = document.getElementById('btn-download-pdf');
  const pdfBtnLabel = document.getElementById('pdf-btn-label');
  const btnPrintCert = document.getElementById('btn-print-cert');
  const btnSubmitAnother = document.getElementById('btn-submit-another');

  // Admin Elements
  const adminAuthBox = document.getElementById('admin-auth-box');
  const adminDashboardBox = document.getElementById('admin-dashboard-box');
  const adminLoginForm = document.getElementById('admin-login-form');
  const adminAuthAlert = document.getElementById('admin-auth-alert');
  const btnAdminLogin = document.getElementById('btn-admin-login');
  const btnBackToPublicForm = document.getElementById('btn-back-to-public-form');
  const btnAdminSignout = document.getElementById('btn-admin-signout');

  // Builder Elements
  const builderFormTitle = document.getElementById('builder-form-title');
  const builderFormDesc = document.getElementById('builder-form-desc');
  const builderQuestionsList = document.getElementById('builder-questions-list');
  const btnBuilderAddQuestion = document.getElementById('btn-builder-add-question');
  const btnBuilderSaveAll = document.getElementById('btn-builder-save-all');

  // JSON Import & Export
  const inputJsonFile = document.getElementById('input-json-file');
  const btnTriggerImportJson = document.getElementById('btn-trigger-import-json');
  const btnExportJson = document.getElementById('btn-export-json');
  const btnShowJsonFormat = document.getElementById('btn-show-json-format');
  const modalJsonFormat = document.getElementById('modal-json-format');
  const btnCloseJsonModal = document.getElementById('btn-close-json-modal');
  const btnDoneJsonModal = document.getElementById('btn-done-json-modal');
  const btnDownloadSampleJson = document.getElementById('btn-download-sample-json');

  // Certificate Customization Elements (Tab C)
  const btnModeDefault = document.getElementById('btn-mode-default');
  const btnModeCustom = document.getElementById('btn-mode-custom');
  const sectionCustomTemplate = document.getElementById('section-custom-template');
  const formCertSettings = document.getElementById('form-cert-settings');

  const inputCertTemplateFile = document.getElementById('input-cert-template-file');
  const certUploadDropzone = document.getElementById('cert-upload-dropzone');
  const certSelectedFilename = document.getElementById('cert-selected-filename');
  const certFileNameText = document.getElementById('cert-file-name-text');
  const btnRemoveTemplate = document.getElementById('btn-remove-template');

  const sliderNameY = document.getElementById('slider-name-y');
  const labelNameY = document.getElementById('label-name-y');
  const sliderNameSize = document.getElementById('slider-name-size');
  const labelNameSize = document.getElementById('label-name-size');
  const selectNameFont = document.getElementById('select-name-font');
  const inputNameColor = document.getElementById('input-name-color');
  const adminCustomCertPreview = document.getElementById('admin-custom-cert-preview');
  const adminNameOverlayPreview = document.getElementById('admin-name-overlay-preview');
  const btnSaveCustomTemplate = document.getElementById('btn-save-custom-template');

  const settingCertTitle = document.getElementById('setting-cert-title');
  const settingCertIssuer = document.getElementById('setting-cert-issuer');
  const settingCertBody = document.getElementById('setting-cert-body');
  const settingCertSigName = document.getElementById('setting-cert-signame');
  const settingCertSigTitle = document.getElementById('setting-cert-sigtitle');

  // Responses Elements
  const responsesCounter = document.getElementById('responses-counter');
  const adminResponseBadge = document.getElementById('admin-response-badge');
  const adminResponsesContainer = document.getElementById('admin-responses-container');
  const btnExportCsv = document.getElementById('btn-export-csv');

  // Share & Config Modals
  const modalSendForm = document.getElementById('modal-send-form');
  const btnCloseSendModal = document.getElementById('btn-close-send-modal');
  const shareLinkInput = document.getElementById('share-link-input');
  const btnCopyFormLink = document.getElementById('btn-copy-form-link');
  const copyBtnText = document.getElementById('copy-btn-text');
  const btnOpenFormLink = document.getElementById('btn-open-form-link');
  const gfToast = document.getElementById('gf-toast');

  const modalSupabaseConfig = document.getElementById('modal-supabase-config');
  const btnCloseConfigModal = document.getElementById('btn-close-config-modal');
  const formSupabaseConfig = document.getElementById('form-supabase-config');
  const cfgUrl = document.getElementById('cfg-url');
  const cfgKey = document.getElementById('cfg-key');
  const btnCfgDemo = document.getElementById('btn-cfg-demo');
  const linkFooterAdmin = document.getElementById('link-footer-admin');
  const linkFooterConfig = document.getElementById('link-footer-config');

  // ---------------------------------------------------------------------------
  // 2. Theme Management (Dark Mode Default)
  // ---------------------------------------------------------------------------
  function initTheme() {
    const savedTheme = localStorage.getItem('ssc_theme') || 'dark';
    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
      themeIcon.textContent = '☀️';
    } else {
      document.body.classList.remove('light-theme');
      themeIcon.textContent = '🌙';
    }
  }

  btnToggleTheme.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('ssc_theme', isLight ? 'light' : 'dark');
    themeIcon.textContent = isLight ? '☀️' : '🌙';
    showToast(isLight ? 'Light theme activated' : 'Dark theme activated');
  });

  // ---------------------------------------------------------------------------
  // 3. Supabase Initialization
  // ---------------------------------------------------------------------------
  function getCredentials() {
    if (!APP_CONFIG.demo) return { url: DEFAULT_SUPABASE_URL, key: DEFAULT_SUPABASE_ANON_KEY };
    const savedUrl = localStorage.getItem('ssc_supabase_url');
    const savedKey = localStorage.getItem('ssc_supabase_key');
    const url = savedUrl || DEFAULT_SUPABASE_URL;
    const key = savedKey || DEFAULT_SUPABASE_ANON_KEY;
    return { url, key, isCustom: Boolean(savedUrl && savedKey) };
  }

  function initSupabase() {
    const { url, key } = getCredentials();
    const isPlaceholder = !url || url.includes('YOUR_SUPABASE_URL') || !key || key.includes('YOUR_SUPABASE_ANON_KEY');

    if (isPlaceholder) {
      isDemoMode = APP_CONFIG.demo;
      return null;
    }

    try {
      supabaseClient = createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      isDemoMode = false;
      return supabaseClient;
    } catch (err) {
      console.error('Supabase initialization failed:', err);
      isDemoMode = false;
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Batch Data Fetch
  // ---------------------------------------------------------------------------
  async function loadAllData() {
    dataReady = false;
    btnSubmitForm.disabled = true;
    if (isDemoMode) {
      formSettings = { ...demoStore.formSettings };
      currentQuestions = [...demoStore.questions].sort((a, b) => a.sort_order - b.sort_order);
      certSettings = { ...demoStore.certificateSettings };
      cachedResponses = [...demoStore.responses];
      applyFormAndCertSettings();
      renderParticipantQuestions();
      renderBuilderQuestions();
      renderAdminResponses();
      dataReady = true;
      btnSubmitForm.disabled = false;
      return;
    }

    try {
      if (!supabaseClient) throw new Error('The database connection is not configured.');
      const [formRes, questionsRes, certRes] = await Promise.all([
        supabaseClient.from('form_settings').select('*').eq('id', 1).maybeSingle(),
        supabaseClient.from('survey_questions').select('*').order('sort_order', { ascending: true }),
        supabaseClient.from('certificate_settings').select('*').eq('id', 1).maybeSingle()
      ]);
      for (const result of [formRes, questionsRes, certRes]) if (result.error) throw result.error;
      if (!formRes.data || !certRes.data) throw new Error('Database setup is incomplete.');

      if (formRes.data) formSettings = formRes.data;
      currentQuestions = questionsRes.data || [];
      if (certRes.data) {
        certSettings = { ...demoStore.certificateSettings, ...certRes.data };
      }
      cachedResponses = [];

      applyFormAndCertSettings();
      renderParticipantQuestions();
      renderBuilderQuestions();
      renderAdminResponses();
      dataReady = true;
      btnSubmitForm.disabled = false;

    } catch (err) {
      console.error('Error loading from Supabase:', err);
      currentQuestions = [];
      participantDynamicQuestions.textContent = 'The form is temporarily unavailable. Please reload to try again or contact the council.';
      participantAlertBox.textContent = 'Unable to load the live form. No response has been saved.';
    }
  }

  function applyFormAndCertSettings() {
    navFormTitle.textContent = formSettings.form_title || 'Summit Feedback';
    publicFormTitle.textContent = formSettings.form_title || 'Participant Feedback & Summit Survey';
    publicFormDesc.textContent = formSettings.form_description || '';
    builderFormTitle.value = formSettings.form_title || '';
    builderFormDesc.value = formSettings.form_description || '';

    // Certificate text
    certTitleDisplay.textContent = certSettings.title || 'Certificate of Completion';
    certIssuerDisplay.textContent = certSettings.issuer || 'SSC Summit';
    const bodyTemplate = certSettings.body || 'This certificate is proudly awarded to {name}.';
    certBodyDisplay.textContent = bodyTemplate.replace(/\{name\}/gi, activeParticipant.name || 'Participant Name');
    certSigScript.textContent = certSettings.signatory_name || 'Authorized SSC Signatory';
    certSigNameDisplay.textContent = certSettings.signatory_name || 'Authorized SSC Signatory';
    certSigTitleDisplay.textContent = certSettings.signatory_title || 'Program Director';

    // Populate default certificate settings form
    settingCertTitle.value = certSettings.title || '';
    settingCertIssuer.value = certSettings.issuer || '';
    settingCertBody.value = certSettings.body || '';
    settingCertSigName.value = certSettings.signatory_name || '';
    settingCertSigTitle.value = certSettings.signatory_title || '';

    // Certificate Mode UI update
    updateCertificateModeUI();
  }

  // ---------------------------------------------------------------------------
  // 5. View 1: Participant Survey Rendering
  // ---------------------------------------------------------------------------
  function renderParticipantQuestions() {
    participantDynamicQuestions.innerHTML = '';

    if (!currentQuestions || currentQuestions.length === 0) {
      participantDynamicQuestions.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">No questions available in this form.</div>`;
      return;
    }

    currentQuestions.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'gf-question-card';
      card.id = `participant-card-${q.id}`;
      card.dataset.questionId = q.id;

      // Question Title Row
      const titleRow = document.createElement('div');
      titleRow.className = 'gf-q-title-row';
      titleRow.innerHTML = `
        <label class="gf-q-title">
          ${idx + 1}. ${escapeHtml(q.question_text)} ${q.is_required ? '<span class="gf-required-star">*</span>' : ''}
        </label>
      `;
      card.appendChild(titleRow);

      // Question body according to question_type
      if (q.question_type === 'rating') {
        const ratingScale = document.createElement('div');
        ratingScale.className = 'gf-rating-scale';
        ratingScale.setAttribute('role', 'radiogroup');

        for (let score = 1; score <= 5; score++) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'gf-rating-cell';
          cell.setAttribute('role', 'radio');
          cell.setAttribute('aria-checked', 'false');
          cell.innerHTML = `<span>${score}</span><span class="gf-rating-sub">${getRatingSub(score)}</span>`;

          cell.addEventListener('click', () => {
            ratingScale.querySelectorAll('.gf-rating-cell').forEach(c => {
              c.classList.remove('selected');
              c.setAttribute('aria-checked', 'false');
            });
            cell.classList.add('selected');
            cell.setAttribute('aria-checked', 'true');
            participantAnswers[q.id] = { text: q.question_text, answer: String(score) };
            card.classList.remove('has-error');
          });

          ratingScale.appendChild(cell);
        }
        card.appendChild(ratingScale);

      } else if (q.question_type === 'choice') {
        const optionsList = document.createElement('div');
        optionsList.className = 'gf-options-list';
        optionsList.setAttribute('role', 'radiogroup');

        const options = parseOptions(q.options);
        options.forEach(opt => {
          const row = document.createElement('div');
          row.className = 'gf-option-row';
          row.tabIndex = 0;
          row.setAttribute('role', 'radio');
          row.setAttribute('aria-checked', 'false');
          row.innerHTML = `
            <div class="gf-radio-circle"></div>
            <span>${escapeHtml(opt)}</span>
          `;

          const selectOption = () => {
            optionsList.querySelectorAll('.gf-option-row').forEach(r => {
              r.classList.remove('selected');
              r.setAttribute('aria-checked', 'false');
            });
            row.classList.add('selected');
            row.setAttribute('aria-checked', 'true');
            participantAnswers[q.id] = { text: q.question_text, answer: opt };
            card.classList.remove('has-error');
          };

          row.addEventListener('click', selectOption);
          row.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              selectOption();
            }
          });

          optionsList.appendChild(row);
        });
        card.appendChild(optionsList);

      } else if (q.question_type === 'checkbox') {
        const optionsList = document.createElement('div');
        optionsList.className = 'gf-options-list';

        const options = parseOptions(q.options);
        const selectedCheckboxes = new Set();

        options.forEach(opt => {
          const row = document.createElement('div');
          row.className = 'gf-option-row';
          row.tabIndex = 0;
          row.innerHTML = `
            <div class="gf-checkbox-square"></div>
            <span>${escapeHtml(opt)}</span>
          `;

          const toggleCheckbox = () => {
            if (selectedCheckboxes.has(opt)) {
              selectedCheckboxes.delete(opt);
              row.classList.remove('selected');
            } else {
              selectedCheckboxes.add(opt);
              row.classList.add('selected');
            }

            if (selectedCheckboxes.size > 0) {
              participantAnswers[q.id] = {
                text: q.question_text,
                answer: Array.from(selectedCheckboxes).join(', ')
              };
              card.classList.remove('has-error');
            } else {
              delete participantAnswers[q.id];
            }
          };

          row.addEventListener('click', toggleCheckbox);
          row.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              toggleCheckbox();
            }
          });

          optionsList.appendChild(row);
        });
        card.appendChild(optionsList);

      } else if (q.question_type === 'paragraph') {
        const textarea = document.createElement('textarea');
        textarea.className = 'gf-input-card gf-textarea';
        textarea.placeholder = 'Your answer';
        textarea.maxLength = 5000;
        textarea.setAttribute('aria-label', q.question_text);
        textarea.addEventListener('input', (e) => {
          const val = e.target.value.trim();
          if (val) {
            participantAnswers[q.id] = { text: q.question_text, answer: val };
            card.classList.remove('has-error');
          } else {
            delete participantAnswers[q.id];
          }
        });
        card.appendChild(textarea);

      } else {
        // Short answer text
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'gf-input-underline';
        input.placeholder = 'Your answer';
        input.maxLength = 5000;
        input.setAttribute('aria-label', q.question_text);
        input.addEventListener('input', (e) => {
          const val = e.target.value.trim();
          if (val) {
            participantAnswers[q.id] = { text: q.question_text, answer: val };
            card.classList.remove('has-error');
          } else {
            delete participantAnswers[q.id];
          }
        });
        card.appendChild(input);
      }

      // Inline Error Indicator
      const errEl = document.createElement('div');
      errEl.className = 'gf-error-text';
      errEl.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        This is a required question
      `;
      card.appendChild(errEl);

      participantDynamicQuestions.appendChild(card);
    });
  }

  function getRatingSub(score) {
    switch (score) {
      case 1: return 'Poor';
      case 2: return 'Fair';
      case 3: return 'Good';
      case 4: return 'V.Good';
      case 5: return 'Excel.';
      default: return '';
    }
  }

  function parseOptions(opts) {
    if (Array.isArray(opts)) return opts;
    if (typeof opts === 'string') {
      try { return JSON.parse(opts); } catch (e) { return opts.split(',').map(s => s.trim()).filter(Boolean); }
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // 6. Form Submission & Postgres 23505 Duplicate Handling
  // ---------------------------------------------------------------------------
  participantSurveyForm.addEventListener('submit', handleParticipantSubmit);

  async function handleParticipantSubmit(e) {
    e.preventDefault();
    if (!dataReady || submitting) return;
    participantAlertBox.innerHTML = '';

    const fullName = inputPName.value.trim();
    const email = inputPEmail.value.trim().toLowerCase();

    let hasError = false;
    let firstErrorCard = null;

    // Validate Name
    if (!fullName || fullName.length > 150) {
      cardPName.classList.add('has-error');
      hasError = true;
      if (!firstErrorCard) firstErrorCard = cardPName;
    } else {
      cardPName.classList.remove('has-error');
    }

    // Validate Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || email.length > 254 || !emailRegex.test(email)) {
      cardPEmail.classList.add('has-error');
      hasError = true;
      if (!firstErrorCard) firstErrorCard = cardPEmail;
    } else {
      cardPEmail.classList.remove('has-error');
    }

    // Validate Required Questions
    currentQuestions.forEach(q => {
      if (q.is_required) {
        const card = document.getElementById(`participant-card-${q.id}`);
        const answered = participantAnswers[q.id] && participantAnswers[q.id].answer && participantAnswers[q.id].answer.trim() !== '';
        if (!answered) {
          if (card) {
            card.classList.add('has-error');
            if (!firstErrorCard) firstErrorCard = card;
          }
          hasError = true;
        } else {
          if (card) card.classList.remove('has-error');
        }
      }
    });

    if (hasError) {
      if (firstErrorCard) {
        firstErrorCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    // Prepare Submission Payload
    const answersMap = {};
    for (const qId in participantAnswers) {
      const item = participantAnswers[qId];
      answersMap[item.text] = item.answer;
    }

    const payload = {
      full_name: fullName,
      email: email,
      answers: answersMap
    };

    activeParticipant = { name: fullName, email: email };
    submitting = true;
    setButtonLoading(btnSubmitForm, true, 'Submitting response...');

    try {
      if (isDemoMode) {
        const exists = demoStore.responses.some(r => r.email === email);
        if (exists) {
          throw { code: '23505', message: 'duplicate key value violates unique constraint' };
        }

        const newRecord = {
          id: 'demo-' + Date.now(),
          full_name: fullName,
          email: email,
          answers: answersMap,
          created_at: new Date().toISOString()
        };
        demoStore.responses.unshift(newRecord);
        cachedResponses.unshift(newRecord);
      } else {
        const { error } = await supabaseClient.from('survey_responses').insert([payload]);
        if (error) throw error;
      }

      setButtonLoading(btnSubmitForm, false, 'Submit & Generate Certificate');
      submitting = false;
      showCertificateView(fullName, email);

    } catch (err) {
      console.error('Submission error:', err);
      setButtonLoading(btnSubmitForm, false, 'Submit & Generate Certificate');
      submitting = false;

      if (err.code === '23505' || (err.message && err.message.toLowerCase().includes('duplicate key'))) {
        participantAlertBox.innerHTML = `
          <div class="gf-header-card" style="border-top-color: #d97706; margin-bottom: 14px;">
            <h3 style="font-size: 1.1rem; color: #f59e0b; margin-bottom: 6px;">
              You have already responded to this form
            </h3>
            <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 12px;">
              A submission has already been registered for this email. Please contact the council if you need your certificate reissued.
            </p>
          </div>
        `;


        participantAlertBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        participantAlertBox.innerHTML = `
          <div class="gf-header-card" style="border-top-color: var(--error); margin-bottom: 14px;">
            <p style="color: var(--error); font-weight: 600;">
              Submission failed: ${escapeHtml(err.message || 'Please check your connection and try again.')}
            </p>
          </div>
        `;
        participantAlertBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  btnClearForm.addEventListener('click', () => {
    if (confirm('Clear form? This will remove your answers from all questions.')) {
      participantSurveyForm.reset();
      participantAnswers = {};
      document.querySelectorAll('.gf-rating-cell.selected').forEach(c => c.classList.remove('selected'));
      document.querySelectorAll('.gf-option-row.selected').forEach(r => r.classList.remove('selected'));
      document.querySelectorAll('.gf-question-card.has-error').forEach(c => c.classList.remove('has-error'));
      participantAlertBox.innerHTML = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // ---------------------------------------------------------------------------
  // 7. View 2: Certificate Display & Dynamic PDF Generation
  // ---------------------------------------------------------------------------
  function showCertificateView(fullName, email) {
    activeParticipant = { name: fullName, email: email };
    certRecipientName.textContent = fullName;
    applyFormAndCertSettings();

    const now = new Date();
    certDateDisplay.textContent = `Date: ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
    const hash = Math.abs(hashCode(email + fullName)).toString(36).toUpperCase().padStart(6, '0');
    certIdDisplay.textContent = `SSC-${now.getFullYear()}-${hash}`;

    // Check certificate mode (Custom vs Default)
    const isCustom = certSettings.template_type === 'custom_pdf' || certSettings.template_type === 'custom_image';
    if (isCustom && certSettings.template_data) {
      certificatePrintArea.style.display = 'none';
      certificateCustomArea.style.display = 'block';

      // Set custom background if image
      if (certSettings.template_type === 'custom_image') {
        certificateCustomArea.style.backgroundImage = `url(${certSettings.template_data})`;
      } else {
        // PDF Template indicator background
        certificateCustomArea.style.backgroundImage = `linear-gradient(135deg, #1e293b, #0f172a)`;
      }

      // Apply overlay styling
      customCertNameDisplay.textContent = fullName;
      customCertNameDisplay.style.top = `${certSettings.name_y_percent || 52}%`;
      customCertNameDisplay.style.fontSize = `${certSettings.name_font_size || 32}px`;
      customCertNameDisplay.style.color = certSettings.name_color || '#1e3a8a';
      applyFontFamily(customCertNameDisplay, certSettings.name_font_family);

    } else {
      certificatePrintArea.style.display = 'flex';
      certificateCustomArea.style.display = 'none';
    }

    viewParticipant.classList.remove('active');
    viewAdmin.classList.remove('active');
    viewCertificate.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function applyFontFamily(el, fontType) {
    if (fontType === 'sans-serif') {
      el.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    } else if (fontType === 'script') {
      el.style.fontFamily = '"Brush Script MT", cursive, serif';
    } else {
      el.style.fontFamily = 'Georgia, "Times New Roman", serif';
    }
  }

  // Lazy-load Engines
  let html2pdfPromise = null;
  function loadHtml2PdfEngine() {
    return html2pdfPromise ||= import('html2pdf.js').then(module => {
      window.html2pdf = module.default;
      return module.default;
    }).catch(error => { html2pdfPromise = null; throw error; });
  }

  function loadPdfLibEngine() { return import('pdf-lib'); }

  // Instant PDF Download
  btnDownloadPdf.addEventListener('click', async () => {
    btnDownloadPdf.disabled = true;
    pdfBtnLabel.textContent = 'Preparing PDF Engine...';

    const safeName = (activeParticipant.name || 'Participant').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Certificate_${safeName}.pdf`;

    try {
      // Branch 1: If using Custom PDF template, modify it directly using pdf-lib!
      if (certSettings.template_type === 'custom_pdf' && certSettings.template_data) {
        pdfBtnLabel.textContent = 'Generating PDF from Template...';
        const PDFLib = await loadPdfLibEngine();

        // Convert base64 data to ArrayBuffer
        const base64Data = certSettings.template_data.split(',')[1] || certSettings.template_data;
        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const pdfDoc = await PDFLib.PDFDocument.load(bytes);
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        const { width, height } = firstPage.getSize();

        // Font
        const fontName = certSettings.name_font_family === 'sans-serif' ? PDFLib.StandardFonts.HelveticaBold : PDFLib.StandardFonts.TimesRomanBold;
        const font = await pdfDoc.embedFont(fontName);

        const participantName = activeParticipant.name || 'Participant Name';
        const fontSize = parseInt(certSettings.name_font_size, 10) || 32;
        const textWidth = font.widthOfTextAtSize(participantName, fontSize);
        const x = (width - textWidth) / 2; // Center horizontally
        
        // Calculate Y (PDF coordinates start from bottom)
        const yPercent = parseInt(certSettings.name_y_percent, 10) || 52;
        const y = height - (height * (yPercent / 100));

        // Color
        const hex = (certSettings.name_color || '#1e3a8a').replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;

        firstPage.drawText(participantName, {
          x: x,
          y: y,
          size: fontSize,
          font: font,
          color: PDFLib.rgb(r, g, b)
        });

        const modifiedPdfBytes = await pdfDoc.save();
        const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);

      } else {
        // Branch 2: Default vector or Custom Image template rendered via html2pdf
        await loadHtml2PdfEngine();
        pdfBtnLabel.textContent = 'Generating PDF...';

        const certEl = certSettings.template_type === 'custom_image'
          ? document.getElementById('certificate-custom-area')
          : document.getElementById('certificate-print-area');

        const opt = {
          margin: [8, 8, 8, 8],
          filename: filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
        };

        const exportCopy = certEl.cloneNode(true);
        exportCopy.style.zoom = '1';
        exportCopy.style.margin = '0 auto';
        if (certSettings.template_type === 'custom_image') exportCopy.style.width = '580px';
        await window.html2pdf().set(opt).from(exportCopy).save();
      }

      pdfBtnLabel.textContent = 'Downloaded!';
      setTimeout(() => {
        pdfBtnLabel.textContent = 'Download Certificate (PDF)';
        btnDownloadPdf.disabled = false;
      }, 2500);

    } catch (err) {
      console.error('PDF error:', err);
      alert('Could not generate PDF: ' + err.message);
      pdfBtnLabel.textContent = 'Download Certificate (PDF)';
      btnDownloadPdf.disabled = false;
    }
  });

  btnPrintCert.addEventListener('click', () => {
    if (certSettings.template_type === 'custom_pdf') {
      showToast('Download your certificate PDF, then print it from your PDF viewer.');
      return;
    }
    window.print();
  });

  btnSubmitAnother.addEventListener('click', () => {
    participantSurveyForm.reset();
    participantAnswers = {};
    document.querySelectorAll('.gf-rating-cell.selected').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.gf-option-row.selected').forEach(r => r.classList.remove('selected'));
    viewCertificate.classList.remove('active');
    viewParticipant.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---------------------------------------------------------------------------
  // 8. View 3: Google Forms Admin Portal
  // ---------------------------------------------------------------------------
  function switchToAdminView() {
    isAdminMode = true;
    viewParticipant.classList.remove('active');
    viewCertificate.classList.remove('active');
    viewAdmin.classList.add('active');
    adminTabsNav.style.display = 'flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    checkAdminAuth();
  }

  function switchToParticipantView() {
    isAdminMode = false;
    viewAdmin.classList.remove('active');
    viewCertificate.classList.remove('active');
    viewParticipant.classList.add('active');
    adminTabsNav.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  btnTogglePreview.addEventListener('click', () => {
    if (isAdminMode) {
      switchToParticipantView();
      showToast('Switched to Participant Form Preview');
    } else {
      switchToAdminView();
    }
  });

  linkFooterAdmin.addEventListener('click', switchToAdminView);
  btnBackToPublicForm.addEventListener('click', switchToParticipantView);

  async function loadAdminResponses() {
    // Page through the API limit so counts and CSV exports include all responses.
    const rows = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabaseClient.from('survey_responses').select('*')
        .order('created_at', { ascending: false }).order('id').range(start, start + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    cachedResponses = rows;
  }

  async function checkAdminAuth() {
    if (isDemoMode) {
      adminAuthBox.style.display = 'none';
      adminDashboardBox.style.display = 'block';
      renderBuilderQuestions();
      renderAdminResponses();
      return;
    }

    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;

      if (session?.user?.app_metadata?.role === 'admin') {
        currentUser = session.user;
        await loadAdminResponses();
        adminAuthBox.style.display = 'none';
        adminDashboardBox.style.display = 'block';
        renderBuilderQuestions();
        renderAdminResponses();
      } else {
        adminAuthBox.style.display = 'block';
        adminDashboardBox.style.display = 'none';
      }
    } catch (err) {
      adminAuthBox.style.display = 'block';
      adminDashboardBox.style.display = 'none';
    }
  }

  adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    adminAuthAlert.innerHTML = '';
    const email = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;

    if (!email || !password) return;
    setButtonLoading(btnAdminLogin, true, 'Signing in...');

    try {
      if (isDemoMode) {
        adminAuthBox.style.display = 'none';
        adminDashboardBox.style.display = 'block';
        showToast('Signed in (Demo Admin)');
        return;
      }

      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;

      if (data.user?.app_metadata?.role !== 'admin') {
        await supabaseClient.auth.signOut();
        throw new Error('This account has not been granted council administrator access.');
      }
      currentUser = data.user;
      await loadAdminResponses();
      adminAuthBox.style.display = 'none';
      adminDashboardBox.style.display = 'block';
      showToast('Signed in successfully');
      renderBuilderQuestions();
      renderAdminResponses();

    } catch (err) {
      adminAuthAlert.innerHTML = `
        <div style="color:var(--error); font-size:0.85rem; margin-bottom:12px;">
          ${escapeHtml(err.message || 'Invalid credentials.')}
        </div>
      `;
    } finally {
      setButtonLoading(btnAdminLogin, false, 'Sign In to Form Builder');
    }
  });

  btnAdminSignout.addEventListener('click', async () => {
    if (supabaseClient) await supabaseClient.auth.signOut();
    currentUser = null;
    cachedResponses = [];
    renderAdminResponses();
    checkAdminAuth();
  });

  document.querySelectorAll('.gf-tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.gf-tab-item').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-pane').forEach(p => p.style.display = 'none');

      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.tab);
      if (targetPane) targetPane.style.display = 'block';
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Interactive Google Forms Builder
  // ---------------------------------------------------------------------------
  function renderBuilderQuestions() {
    builderQuestionsList.innerHTML = '';

    currentQuestions.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'gf-question-card gf-card-builder';
      card.dataset.id = q.id;

      const qRow = document.createElement('div');
      qRow.className = 'gf-builder-q-row';
      qRow.innerHTML = `
        <input 
          type="text" 
          class="gf-input-underline q-builder-prompt" 
          value="${escapeHtml(q.question_text)}" 
          placeholder="Question"
        >
        <select class="gf-select q-builder-type">
          <option value="rating" ${q.question_type === 'rating' ? 'selected' : ''}>Linear scale (1-5)</option>
          <option value="choice" ${q.question_type === 'choice' ? 'selected' : ''}>Multiple choice</option>
          <option value="checkbox" ${q.question_type === 'checkbox' ? 'selected' : ''}>Checkboxes</option>
          <option value="text" ${q.question_type === 'text' ? 'selected' : ''}>Short answer</option>
          <option value="paragraph" ${q.question_type === 'paragraph' ? 'selected' : ''}>Paragraph</option>
        </select>
      `;
      card.appendChild(qRow);

      const optionsBox = document.createElement('div');
      optionsBox.className = 'q-builder-options-box';
      const isChoiceType = q.question_type === 'choice' || q.question_type === 'checkbox';
      optionsBox.style.display = isChoiceType ? 'block' : 'none';

      const optionsList = parseOptions(q.options);
      renderBuilderOptionRows(optionsBox, optionsList, q.question_type);
      card.appendChild(optionsBox);

      const typeSelect = qRow.querySelector('.q-builder-type');
      typeSelect.addEventListener('change', () => {
        const newType = typeSelect.value;
        q.question_type = newType;
        if (newType === 'choice' || newType === 'checkbox') {
          optionsBox.style.display = 'block';
          if (!q.options || parseOptions(q.options).length === 0) {
            q.options = ['Option 1'];
          }
          renderBuilderOptionRows(optionsBox, parseOptions(q.options), newType);
        } else {
          optionsBox.style.display = 'none';
        }
      });

      const footer = document.createElement('div');
      footer.className = 'gf-builder-card-footer';
      footer.innerHTML = `
        <button type="button" class="icon-btn btn-dup-q" title="Duplicate question">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <button type="button" class="icon-btn btn-del-q" title="Delete question">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        <div style="width:1px; height:20px; background:var(--border); margin:0 4px;"></div>
        <label class="gf-switch-label">
          <span>Required</span>
          <div class="gf-toggle">
            <input type="checkbox" class="q-builder-required" ${q.is_required ? 'checked' : ''}>
            <span class="gf-slider"></span>
          </div>
        </label>
      `;

      footer.querySelector('.btn-dup-q').addEventListener('click', () => {
        const cloned = {
          ...q,
          id: 'q-' + Date.now(),
          question_text: q.question_text + ' (Copy)',
          sort_order: currentQuestions.length + 1
        };
        currentQuestions.splice(idx + 1, 0, cloned);
        renderBuilderQuestions();
        renderParticipantQuestions();
        showToast('Question duplicated');
      });

      footer.querySelector('.btn-del-q').addEventListener('click', () => {
        if (confirm('Delete this question?')) {
          currentQuestions.splice(idx, 1);
          renderBuilderQuestions();
          renderParticipantQuestions();
          showToast('Question removed');
        }
      });

      card.appendChild(footer);
      builderQuestionsList.appendChild(card);
    });
  }

  function renderBuilderOptionRows(container, optionsList, questionType) {
    container.innerHTML = '';
    const listWrapper = document.createElement('div');
    listWrapper.className = 'q-options-wrapper';

    optionsList.forEach((optText, optIdx) => {
      const row = document.createElement('div');
      row.className = 'gf-builder-option-row';
      row.innerHTML = `
        <div style="color:var(--text-muted); font-size:1.1rem; width:20px; text-align:center;">
          ${questionType === 'checkbox' ? '☐' : '○'}
        </div>
        <input type="text" class="gf-input-underline opt-input" value="${escapeHtml(optText)}" placeholder="Option ${optIdx + 1}">
        <button type="button" class="gf-btn-del-option" title="Remove option">&times;</button>
      `;

      row.querySelector('.gf-btn-del-option').addEventListener('click', () => {
        optionsList.splice(optIdx, 1);
        renderBuilderOptionRows(container, optionsList, questionType);
      });

      listWrapper.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'gf-btn-add-option';
    addBtn.innerHTML = `<span>+</span> <span>Add option</span>`;
    addBtn.addEventListener('click', () => {
      optionsList.push(`Option ${optionsList.length + 1}`);
      renderBuilderOptionRows(container, optionsList, questionType);
    });

    container.appendChild(listWrapper);
    container.appendChild(addBtn);
  }

  btnBuilderAddQuestion.addEventListener('click', () => {
    const newQ = {
      id: 'q-' + Date.now(),
      question_text: 'Untitled Question',
      question_type: 'choice',
      options: ['Option 1'],
      is_required: true,
      sort_order: currentQuestions.length + 1
    };
    currentQuestions.push(newQ);
    renderBuilderQuestions();
    renderParticipantQuestions();

    const cards = builderQuestionsList.querySelectorAll('.gf-card-builder');
    if (cards.length > 0) {
      cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
      const promptInput = cards[cards.length - 1].querySelector('.q-builder-prompt');
      if (promptInput) promptInput.focus();
    }
  });

  // Builder: Save All
  btnBuilderSaveAll.addEventListener('click', async () => {
    const cards = builderQuestionsList.querySelectorAll('.gf-card-builder');
    const updatedQuestions = [];

    cards.forEach((card, i) => {
      const qId = card.dataset.id;
      const prompt = card.querySelector('.q-builder-prompt').value.trim() || 'Untitled Question';
      const type = card.querySelector('.q-builder-type').value;
      const isReq = card.querySelector('.q-builder-required').checked;

      let options = [];
      if (type === 'choice' || type === 'checkbox') {
        const optInputs = card.querySelectorAll('.opt-input');
        optInputs.forEach(inp => {
          const val = inp.value.trim();
          if (val) options.push(val);
        });
        if (options.length === 0) options = ['Option 1'];
      }

      updatedQuestions.push({
        id: qId,
        question_text: prompt,
        question_type: type,
        options: options,
        is_required: isReq,
        sort_order: i + 1
      });
    });

    currentQuestions = updatedQuestions;
    formSettings.form_title = builderFormTitle.value.trim() || 'Summit Feedback';
    formSettings.form_description = builderFormDesc.value.trim() || '';

    setButtonLoading(btnBuilderSaveAll, true, 'Saving...');

    try {
      if (isDemoMode) {
        demoStore.questions = [...currentQuestions];
        demoStore.formSettings = { ...formSettings };
      } else {
        const rowsToSave = currentQuestions.map(q => ({ ...q,
          id: /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(q.id) ? q.id : crypto.randomUUID()
        }));
        const { error } = await supabaseClient.rpc('save_survey', {
          p_title: formSettings.form_title,
          p_description: formSettings.form_description,
          p_questions: rowsToSave
        });
        if (error) throw error;
        currentQuestions = rowsToSave;
        renderBuilderQuestions();
      }

      applyFormAndCertSettings();
      renderParticipantQuestions();
      showToast('Form questions saved successfully');

    } catch (err) {
      console.error('Error saving builder questions:', err);
      alert('Could not save questions: ' + err.message);
    } finally {
      setButtonLoading(btnBuilderSaveAll, false, 'Save Changes');
    }
  });

  // ---------------------------------------------------------------------------
  // 10. Automatic JSON Question Import & Export
  // ---------------------------------------------------------------------------
  btnTriggerImportJson.addEventListener('click', () => inputJsonFile.click());

  inputJsonFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        let importedList = [];

        // Check if root is array or an object with questions
        if (Array.isArray(parsed)) {
          importedList = parsed;
        } else if (parsed && Array.isArray(parsed.questions)) {
          importedList = parsed.questions;
          if (parsed.form_title || parsed.title) {
            builderFormTitle.value = parsed.form_title || parsed.title;
            formSettings.form_title = builderFormTitle.value;
          }
          if (parsed.form_description || parsed.description) {
            builderFormDesc.value = parsed.form_description || parsed.description;
            formSettings.form_description = builderFormDesc.value;
          }
        } else {
          throw new Error('Invalid JSON structure: Expected an array of questions or an object with a "questions" array.');
        }

        if (importedList.length === 0) {
          throw new Error('JSON file contains no questions.');
        }

        // Normalize each question
        const validTypes = ['rating', 'choice', 'checkbox', 'text', 'paragraph'];
        const normalized = importedList.map((item, index) => {
          let type = (item.question_type || item.type || 'text').toLowerCase();
          if (!validTypes.includes(type)) {
            if (type.includes('rate') || type.includes('scale')) type = 'rating';
            else if (type.includes('radio') || type.includes('select')) type = 'choice';
            else if (type.includes('check')) type = 'checkbox';
            else if (type.includes('area') || type.includes('long')) type = 'paragraph';
            else type = 'text';
          }

          let options = [];
          if (type === 'choice' || type === 'checkbox') {
            options = parseOptions(item.options || item.choices || ['Option 1', 'Option 2']);
          }

          return {
            id: 'json-q-' + Date.now() + '-' + index,
            question_text: item.question_text || item.text || item.prompt || `Question ${index + 1}`,
            question_type: type,
            options: options,
            is_required: item.is_required !== undefined ? Boolean(item.is_required) : true,
            sort_order: index + 1
          };
        });

        // Prompt admin whether to replace or append
        const replace = confirm(`Successfully parsed ${normalized.length} questions from JSON.\n\nClick OK to REPLACE current questions.\nClick Cancel to APPEND them.`);
        if (replace) {
          currentQuestions = normalized;
        } else {
          currentQuestions = currentQuestions.concat(normalized).map((q, idx) => ({ ...q, sort_order: idx + 1 }));
        }

        renderBuilderQuestions();
        renderParticipantQuestions();
        showToast(`Imported ${normalized.length} questions from JSON!`);
        inputJsonFile.value = '';

      } catch (err) {
        console.error('JSON import error:', err);
        alert('Could not import JSON: ' + err.message);
        inputJsonFile.value = '';
      }
    };
    reader.readAsText(file);
  });

  // Export JSON
  btnExportJson.addEventListener('click', () => {
    if (currentQuestions.length === 0) {
      alert('No questions to export.');
      return;
    }

    const exportData = {
      form_title: formSettings.form_title,
      form_description: formSettings.form_description,
      questions: currentQuestions.map(q => ({
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.options,
        is_required: q.is_required,
        sort_order: q.sort_order
      }))
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `survey-questions-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Questions exported to JSON');
  });

  // JSON Format Modal
  btnShowJsonFormat.addEventListener('click', () => modalJsonFormat.classList.add('open'));
  btnCloseJsonModal.addEventListener('click', () => modalJsonFormat.classList.remove('open'));
  btnDoneJsonModal.addEventListener('click', () => modalJsonFormat.classList.remove('open'));

  btnDownloadSampleJson.addEventListener('click', () => {
    const sample = [
      {
        question_text: "How would you rate the overall summit experience?",
        question_type: "rating",
        is_required: true
      },
      {
        question_text: "Which session tracks did you attend?",
        question_type: "choice",
        options: ["Keynote & Opening", "Technical Deep Dives", "Interactive Workshop"],
        is_required: true
      },
      {
        question_text: "Which technologies are you actively adopting?",
        question_type: "checkbox",
        options: ["Supabase", "Cloudflare Workers", "React / Next.js", "AI Agents"],
        is_required: false
      },
      {
        question_text: "What suggestions do you have for next time?",
        question_type: "paragraph",
        is_required: false
      }
    ];

    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample-survey-questions.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    modalJsonFormat.classList.remove('open');
    showToast('Downloaded sample JSON template');
  });

  // ---------------------------------------------------------------------------
  // 11. Custom Certificate Template Upload & Positioning
  // ---------------------------------------------------------------------------
  btnModeDefault.addEventListener('click', () => {
    certSettings.template_type = 'default';
    updateCertificateModeUI();
  });

  btnModeCustom.addEventListener('click', () => {
    certSettings.template_type = certSettings.template_data ? (certSettings.template_filename.endsWith('.pdf') ? 'custom_pdf' : 'custom_image') : 'custom_pdf';
    updateCertificateModeUI();
  });

  function updateCertificateModeUI() {
    const isCustom = certSettings.template_type === 'custom_pdf' || certSettings.template_type === 'custom_image';
    if (isCustom) {
      btnModeCustom.classList.add('active');
      btnModeDefault.classList.remove('active');
      sectionCustomTemplate.style.display = 'block';
      formCertSettings.style.display = 'none';
      updateLiveCustomPreview();
    } else {
      btnModeDefault.classList.add('active');
      btnModeCustom.classList.remove('active');
      sectionCustomTemplate.style.display = 'none';
      formCertSettings.style.display = 'block';
    }

    // Update uploader badge
    if (certSettings.template_filename) {
      certSelectedFilename.style.display = 'inline-flex';
      certFileNameText.textContent = certSettings.template_filename;
    } else {
      certSelectedFilename.style.display = 'none';
    }

    // Update sliders
    sliderNameY.value = certSettings.name_y_percent || 52;
    labelNameY.textContent = `${sliderNameY.value}%`;

    sliderNameSize.value = certSettings.name_font_size || 32;
    labelNameSize.textContent = `${sliderNameSize.value}px`;

    selectNameFont.value = certSettings.name_font_family || 'serif';
    inputNameColor.value = certSettings.name_color || '#1e3a8a';
  }

  // Upload Dropzone Click
  certUploadDropzone.addEventListener('click', () => inputCertTemplateFile.click());

  // Drag and Drop
  certUploadDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    certUploadDropzone.classList.add('dragover');
  });
  certUploadDropzone.addEventListener('dragleave', () => certUploadDropzone.classList.remove('dragover'));
  certUploadDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    certUploadDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleTemplateFile(e.dataTransfer.files[0]);
    }
  });

  inputCertTemplateFile.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleTemplateFile(e.target.files[0]);
    }
  });

  function handleTemplateFile(file) {
    if (file.size > 3 * 1024 * 1024) { alert('Choose a template smaller than 3 MB.'); return; }
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    const isImg = ['image/png', 'image/jpeg'].includes(file.type);

    if (!isPdf && !isImg) {
      alert('Please upload a PDF (.pdf) or Image (.png, .jpg) file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      certSettings.template_type = isPdf ? 'custom_pdf' : 'custom_image';
      certSettings.template_filename = file.name;
      certSettings.template_data = e.target.result; // Base64 Data URL

      certSelectedFilename.style.display = 'inline-flex';
      certFileNameText.textContent = file.name;
      updateLiveCustomPreview();
      showToast(`Template uploaded: ${file.name}`);
    };
    reader.readAsDataURL(file);
  }

  btnRemoveTemplate.addEventListener('click', (e) => {
    e.stopPropagation();
    certSettings.template_data = '';
    certSettings.template_filename = '';
    certSettings.template_type = 'default';
    inputCertTemplateFile.value = '';
    updateCertificateModeUI();
    showToast('Custom template removed');
  });

  // Slider adjustments in real time
  sliderNameY.addEventListener('input', (e) => {
    labelNameY.textContent = `${e.target.value}%`;
    certSettings.name_y_percent = parseInt(e.target.value, 10);
    updateLiveCustomPreview();
  });

  sliderNameSize.addEventListener('input', (e) => {
    labelNameSize.textContent = `${e.target.value}px`;
    certSettings.name_font_size = parseInt(e.target.value, 10);
    updateLiveCustomPreview();
  });

  selectNameFont.addEventListener('change', (e) => {
    certSettings.name_font_family = e.target.value;
    updateLiveCustomPreview();
  });

  inputNameColor.addEventListener('input', (e) => {
    certSettings.name_color = e.target.value;
    updateLiveCustomPreview();
  });

  function updateLiveCustomPreview() {
    if (certSettings.template_type === 'custom_image' && certSettings.template_data) {
      adminCustomCertPreview.style.backgroundImage = `url(${certSettings.template_data})`;
    } else if (certSettings.template_type === 'custom_pdf') {
      adminCustomCertPreview.style.backgroundImage = `linear-gradient(135deg, #1e293b, #0f172a)`;
    } else {
      adminCustomCertPreview.style.backgroundImage = 'none';
    }

    adminNameOverlayPreview.style.top = `${certSettings.name_y_percent || 52}%`;
    adminNameOverlayPreview.style.fontSize = `${certSettings.name_font_size || 32}px`;
    adminNameOverlayPreview.style.color = certSettings.name_color || '#1e3a8a';
    applyFontFamily(adminNameOverlayPreview, certSettings.name_font_family);
  }

  // Save Custom Template Settings
  btnSaveCustomTemplate.addEventListener('click', async () => {
    const updated = {
      id: 1,
      template_type: certSettings.template_type,
      template_data: certSettings.template_data || '',
      template_filename: certSettings.template_filename || '',
      name_y_percent: parseInt(sliderNameY.value, 10),
      name_font_size: parseInt(sliderNameSize.value, 10),
      name_color: inputNameColor.value,
      name_font_family: selectNameFont.value,
      updated_at: new Date().toISOString()
    };

    setButtonLoading(btnSaveCustomTemplate, true, 'Saving...');

    try {
      if (isDemoMode) {
        demoStore.certificateSettings = { ...demoStore.certificateSettings, ...updated };
        certSettings = { ...certSettings, ...updated };
      } else {
        const { error } = await supabaseClient.from('certificate_settings').upsert(updated);
        if (error) throw error;
        certSettings = { ...certSettings, ...updated };
      }

      showToast('Custom template settings saved successfully!');
    } catch (err) {
      alert('Could not save template settings: ' + err.message);
    } finally {
      setButtonLoading(btnSaveCustomTemplate, false, 'Save Custom Template Settings');
    }
  });

  // Default Template Settings Form Save
  formCertSettings.addEventListener('submit', async (e) => {
    e.preventDefault();
    const updated = {
      id: 1,
      title: settingCertTitle.value.trim(),
      issuer: settingCertIssuer.value.trim(),
      body: settingCertBody.value.trim(),
      signatory_name: settingCertSigName.value.trim(),
      signatory_title: settingCertSigTitle.value.trim(),
      template_type: 'default',
      updated_at: new Date().toISOString()
    };

    try {
      if (isDemoMode) {
        demoStore.certificateSettings = { ...demoStore.certificateSettings, ...updated };
        certSettings = { ...certSettings, ...updated };
      } else {
        const { error } = await supabaseClient.from('certificate_settings').upsert(updated);
        if (error) throw error;
        certSettings = { ...certSettings, ...updated };
      }

      applyFormAndCertSettings();
      showToast('Built-in certificate settings saved');
    } catch (err) {
      alert('Error updating certificate settings: ' + err.message);
    }
  });

  // ---------------------------------------------------------------------------
  // 12. Admin Responses & CSV Export
  // ---------------------------------------------------------------------------
  function renderAdminResponses() {
    responsesCounter.textContent = cachedResponses.length;
    adminResponseBadge.textContent = cachedResponses.length;

    if (cachedResponses.length === 0) {
      adminResponsesContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">No responses received yet.</div>`;
      return;
    }

    adminResponsesContainer.innerHTML = '';
    cachedResponses.forEach(r => {
      const card = document.createElement('div');
      card.className = 'gf-question-card';
      card.style.cursor = 'pointer';

      const time = new Date(r.created_at).toLocaleString();
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700; font-size:1rem;">${escapeHtml(r.full_name)}</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(r.email)} &bull; ${time}</div>
          </div>
          <span style="font-size:1.1rem; color:var(--text-muted);">&blacktriangledown;</span>
        </div>
        <div class="resp-details" style="display:none; margin-top:12px; padding-top:10px; border-top:1px dashed var(--border);"></div>
      `;

      const details = card.querySelector('.resp-details');
      for (const [qText, aVal] of Object.entries(r.answers || {})) {
        const qaRow = document.createElement('div');
        qaRow.style.marginBottom = '6px';
        qaRow.innerHTML = `
          <div style="font-size:0.8rem; font-weight:600; color:var(--primary);">${escapeHtml(qText)}</div>
          <div style="font-size:0.9rem; color:var(--text-main);">${escapeHtml(String(aVal))}</div>
        `;
        details.appendChild(qaRow);
      }

      card.addEventListener('click', () => {
        details.style.display = details.style.display === 'none' ? 'block' : 'none';
      });

      adminResponsesContainer.appendChild(card);
    });
  }

  btnExportCsv.addEventListener('click', () => {
    if (cachedResponses.length === 0) {
      alert('No responses available to export.');
      return;
    }

    const questionHeaders = new Set();
    cachedResponses.forEach(r => {
      if (r.answers) Object.keys(r.answers).forEach(k => questionHeaders.add(k));
    });

    const headersArray = Array.from(questionHeaders);
    const columns = ['Timestamp', 'Full Name', 'Email', ...headersArray];

    const csvRows = [columns.map(c => `"${escapeCsv(c)}"`).join(',')];
    cachedResponses.forEach(r => {
      const row = [
        new Date(r.created_at).toISOString(),
        r.full_name || '',
        r.email || ''
      ];
      headersArray.forEach(qHeader => {
        const val = (r.answers && r.answers[qHeader] !== undefined) ? String(r.answers[qHeader]) : '';
        row.push(val);
      });
      csvRows.push(row.map(v => `"${escapeCsv(v)}"`).join(','));
    });

    const csvContent = '\uFEFF' + csvRows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SSC_Form_Responses_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('CSV Exported');
  });

  // ---------------------------------------------------------------------------
  // 13. Send Form / Share Link Modal
  // ---------------------------------------------------------------------------
  btnOpenSendModal.addEventListener('click', () => {
    const cleanUrl = window.location.origin + window.location.pathname;
    shareLinkInput.value = cleanUrl;
    copyBtnText.textContent = 'Copy';
    modalSendForm.classList.add('open');
  });

  btnCloseSendModal.addEventListener('click', () => modalSendForm.classList.remove('open'));

  btnCopyFormLink.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareLinkInput.value);
      copyBtnText.textContent = 'Copied!';
      showToast('Link copied to clipboard');
      setTimeout(() => copyBtnText.textContent = 'Copy', 2000);
    } catch (e) {
      shareLinkInput.select();
      document.execCommand('copy');
      copyBtnText.textContent = 'Copied!';
      showToast('Link copied to clipboard');
    }
  });

  btnOpenFormLink.addEventListener('click', () => {
    window.open(shareLinkInput.value, '_blank');
  });

  // ---------------------------------------------------------------------------
  // 14. Supabase Configuration Modal
  // ---------------------------------------------------------------------------
  linkFooterConfig.addEventListener('click', () => {
    const { url, key } = getCredentials();
    cfgUrl.value = url === DEFAULT_SUPABASE_URL ? '' : url;
    cfgKey.value = key === DEFAULT_SUPABASE_ANON_KEY ? '' : key;
    modalSupabaseConfig.classList.add('open');
  });

  btnCloseConfigModal.addEventListener('click', () => modalSupabaseConfig.classList.remove('open'));

  formSupabaseConfig.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = cfgUrl.value.trim();
    const key = cfgKey.value.trim();
    if (!url || !key) return;

    localStorage.setItem('ssc_supabase_url', url);
    localStorage.setItem('ssc_supabase_key', key);
    initSupabase();
    await loadAllData();
    modalSupabaseConfig.classList.remove('open');
    showToast('Supabase Connected');
  });

  btnCfgDemo.addEventListener('click', async () => {
    localStorage.removeItem('ssc_supabase_url');
    localStorage.removeItem('ssc_supabase_key');
    initSupabase();
    await loadAllData();
    modalSupabaseConfig.classList.remove('open');
    showToast('Switched to Demo Mode');
  });

  // ---------------------------------------------------------------------------
  // 15. Utilities & Helpers
  // ---------------------------------------------------------------------------
  function showToast(msg) {
    gfToast.textContent = msg;
    gfToast.classList.add('show');
    setTimeout(() => gfToast.classList.remove('show'), 2600);
  }

  function setButtonLoading(btn, isLoading, text) {
    if (!btn) return;
    btn.disabled = isLoading;
    if (isLoading) {
      btn.innerHTML = `<span class="spinner"></span> <span>${escapeHtml(text)}</span>`;
    } else {
      btn.innerHTML = `<span>${escapeHtml(text)}</span>`;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeCsv(str) {
    if (!str) return '';
    const value = String(str);
    return (/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""');
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  // ---------------------------------------------------------------------------
  // 16. URL Query Routing & Bootstrap
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    linkFooterConfig.hidden = !APP_CONFIG.demo;
    if (APP_CONFIG.demo) {
      document.getElementById('deployment-notice').hidden = false;
      document.getElementById('deployment-notice').textContent = 'Demo preview — responses and changes are temporary and are not saved to a database.';
    }
    initSupabase();
    if (supabaseClient) supabaseClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        cachedResponses = [];
        renderAdminResponses();
        adminDashboardBox.style.display = 'none';
        adminAuthBox.style.display = 'block';
      }
    });
    await loadAllData();

    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === '1' || params.get('mode') === 'admin') {
      switchToAdminView();
    } else {
      switchToParticipantView();
    }
  });

})();
