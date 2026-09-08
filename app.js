// 1FOR1M — Main App Logic
(function() {
  const cfg = window.FOR1M || {};
  const PRICE = cfg.pricePerLot || 1;
  const TOTAL_LOTS = cfg.totalLots || 1000000;

  let supabase = null;
  let stripe = null;
  let currentUser = null;
  let selectedLots = new Set();
  let lotsData = new Map();
  let gridOffset = 0;
  let gridCells = [];
  let isDragging = false;
  let dragStartLot = null;

  // ── Init ──
  async function init() {
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    }
    if (cfg.stripePublishableKey) {
      stripe = Stripe(cfg.stripePublishableKey);
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      currentUser = session.user;
      showApp();
    } else {
      showLogin();
    }
  }

  // ── Login ──
  function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('main-app').style.display = 'none';
  }

  function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    document.getElementById('user-email').textContent = currentUser?.email || '';
    loadStats();
    renderGrid();
  }

  document.getElementById('google-login')?.addEventListener('click', async () => {
    if (!cfg.googleClientId) {
      alert('Configure googleClientId in config.js');
      return;
    }
    const { data, error } = await supabase.auth.oauth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        scopes: 'email profile'
      }
    });
    if (error) alert('Login failed: ' + error.message);
  });

  document.getElementById('logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    currentUser = null;
    selectedLots.clear();
    showLogin();
  });

  // ── Stats ──
  async function loadStats() {
    if (!supabase) return;
    try {
      const { count: available } = await supabase
        .from('lots')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'available');
      const { count: sold } = await supabase
        .from('lots')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'sold');
      document.getElementById('stat-available').textContent = (available || 0).toLocaleString();
      document.getElementById('stat-sold').textContent = (sold || 0).toLocaleString();
    } catch(e) { console.error('Stats error', e); }
  }
  // ── Grid Rendering (virtualized) ──
  const COLS = 20;
  const CELL_SIZE = 48;
  const GAP = 2;
  const ROWS_PER_PAGE = 25; // 25 rows x 20 cols = 500 lots per page
  const PAGE_SIZE = COLS * ROWS_PER_PAGE;
  const TOTAL_PAGES = Math.ceil(TOTAL_LOTS / PAGE_SIZE);
  let currentPage = 0;

  function renderGrid() {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = 'repeat(' + COLS + ', ' + CELL_SIZE + 'px)';
    grid.style.gridAutoRows = CELL_SIZE + 'px';

    const start = currentPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, TOTAL_LOTS);

    for (let i = start; i < end; i++) {
      const cell = document.createElement('div');
      cell.className = 'lot-cell';
      cell.dataset.lot = i + 1;
      const num = document.createElement('span');
      num.className = 'lot-num';
      num.textContent = (i + 1).toString().padStart(6, '0');
      cell.appendChild(num);

      // Hover: show media upload
      cell.addEventListener('mouseenter', () => onLotHover(i + 1, cell));
      // Click: toggle selection
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        onLotClick(i + 1, cell);
      });

      // Drag selection
      cell.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStartLot = i + 1;
        e.preventDefault();
      });

      gridCells.push({ lot: i + 1, el: cell });
    }

    // Mouse move for drag selection
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', () => { isDragging = false; });

    // Wheel to change pages
    const gridContainer = document.getElementById('grid');
    gridContainer.addEventListener('wheel', (e) => {
      if (e.deltaY > 0 && currentPage < TOTAL_PAGES - 1) {
        currentPage++;
        refreshGrid();
      } else if (e.deltaY < 0 && currentPage > 0) {
        currentPage--;
        refreshGrid();
      }
    }, { passive: true });
  }

  function refreshGrid() {
    gridCells = [];
    renderGrid();
  }

  function onDragMove(e) {
    if (!isDragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el.classList && el.classList.contains('lot-cell')) {
      const lot = parseInt(el.dataset.lot);
      if (!isNaN(lot)) {
        // Select range from dragStartLot to current lot
        const min = Math.min(dragStartLot, lot);
        const max = Math.max(dragStartLot, lot);
        for (let i = min; i <= max; i++) {
          selectedLots.add(i);
        }
        dragStartLot = lot;
        updateSelectionUI();
      }
    }
  }

  // ── Lot Hover: Media Upload ──
  let currentHoverLot = null;
  let hoverTimer = null;

  function onLotHover(lotNum, cell) {
    currentHoverLot = lotNum;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      showMediaUpload(lotNum);
    }, 300);
  }

  function showMediaUpload(lotNum) {
    const overlay = document.getElementById('grid-overlay');
    const content = document.getElementById('media-content');
    const lotNumEl = document.getElementById('media-lot-num');
    const statusEl = document.getElementById('media-status');

    lotNumEl.textContent = String(lotNum).padStart(6, '0');
    overlay.style.display = 'flex';

    // Check if lot has existing media
    const data = lotsData.get(lotNum);
    if (data && data.media) {
      if (data.media.type === 'image') {
        content.innerHTML = '<img src="' + escapeHtml(data.media.url) + '" alt="Lot ' + lotNum + '" max-width="720">';
      } else if (data.media.type === 'video') {
        content.innerHTML = '<video controls max-width="720"><source src="' + escapeHtml(data.media.url) + '"></video>';
      } else if (data.media.type === 'audio') {
        content.innerHTML = '<audio controls><source src="' + escapeHtml(data.media.url) + '"></audio>';
      }
      statusEl.textContent = data.status === 'sold' ? 'SOLD' : 'AVAILABLE';
    } else {
      // Show upload interface
      content.innerHTML = '' +
        '<div class="upload-prompt">' +
          '<p>Upload media for this lot (max 720px)</p>' +
          '<div class="upload-buttons">' +
            '<label class="upload-btn"><input type="file" accept="image/*" class="upload-file" data-type="image"> Image</label>' +
            '<label class="upload-btn"><input type="file" accept="video/*" class="upload-file" data-type="video"> Video</label>' +
            '<label class="upload-btn"><input type="file" accept="audio/*" class="upload-file" data-type="audio"> Audio</label>' +
          '</div>' +
        '</div>';
      statusEl.textContent = 'AVAILABLE';
    }

    // Wire up file inputs
    content.querySelectorAll('.upload-file').forEach(input => {
      input.onchange = (e) => handleMediaUpload(lotNum, e.target);
    });
  }

  async function handleMediaUpload(lotNum, input) {
    const file = input.files[0];
    if (!file) return;

    // Resize images to max 720px
    let fileToUpload = file;
    if (file.type.startsWith('image/')) {
      fileToUpload = await resizeImage(file, 720);
    }

    // Upload to Supabase Storage
    const ext = fileToUpload.name.split('.').pop() || 'bin';
    const path = 'lots/' + lotNum + '/' + Date.now() + '.' + ext;
    const { data, error } = await supabase.storage
      .from('lots-media')
      .upload(path, fileToUpload, { upsert: true });

    if (error) {
      alert('Upload failed: ' + error.message);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('lots-media')
      .getPublicUrl(path);

    // Save media record
    await supabase.from('media_uploads').insert({
      lot_id: lotNum,
      user_id: currentUser.id,
      type: input.dataset.type,
      file_path: path,
      file_size: fileToUpload.size,
      mime_type: fileToUpload.type
    });

    // Update lot media
    const mediaField = input.dataset.type + '_url';
    await supabase.from('lots').update({ [mediaField]: publicUrl }).eq('lot_number', lotNum);

    // Refresh
    lotsData.set(lotNum, { ...lotsData.get(lotNum), media: { type: input.dataset.type, url: publicUrl } });
    showMediaUpload(lotNum);
  }

  function resizeImage(file, maxSize) {
    return new Promise((resolve) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, { type: file.type }));
        }, file.type, 0.85);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ── Lot Click: Selection ──
  function onLotClick(lotNum, cell) {
    if (lotsData.get(lotNum)?.status === 'sold') return;

    if (selectedLots.has(lotNum)) {
      selectedLots.delete(lotNum);
      cell.classList.remove('selected');
    } else {
      selectedLots.add(lotNum);
      cell.classList.add('selected');
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const count = selectedLots.size;
    const total = count * PRICE;
    const bar = document.getElementById('selection-bar');
    document.getElementById('selection-count').textContent = count;
    document.getElementById('selection-total').textContent = total;
    bar.style.display = count > 0 ? 'flex' : 'none';

    // Update cell states
    gridCells.forEach(({ lot, el }) => {
      if (selectedLots.has(lot)) el.classList.add('selected');
      else el.classList.remove('selected');
    });
  }

  document.getElementById('clear-selection')?.addEventListener('click', () => {
    selectedLots.clear();
    updateSelectionUI();
  });

  // ── Checkout ──
  document.getElementById('buy-selected')?.addEventListener('click', () => {
    if (selectedLots.size === 0) return;
    document.getElementById('quantity-modal').style.display = 'flex';
    document.getElementById('qty-input').value = selectedLots.size;
    updateCheckoutTotal();
  });

  document.getElementById('qty-minus')?.addEventListener('click', () => {
    const input = document.getElementById('qty-input');
    let v = parseInt(input.value) || 1;
    if (v > 1) {
      input.value = v - 1;
      updateCheckoutTotal();
    }
  });

  document.getElementById('qty-plus')?.addEventListener('click', () => {
    const input = document.getElementById('qty-input');
    let v = parseInt(input.value) || 1;
    if (v < 100) {
      input.value = v + 1;
      updateCheckoutTotal();
    }
  });

  document.getElementById('qty-input')?.addEventListener('input', updateCheckoutTotal);

  function updateCheckoutTotal() {
    const qty = parseInt(document.getElementById('qty-input').value) || 1;
    document.getElementById('checkout-total').textContent = qty * PRICE;
  }

  document.getElementById('checkout-cancel')?.addEventListener('click', () => {
    document.getElementById('quantity-modal').style.display = 'none';
  });

  document.getElementById('checkout-confirm')?.addEventListener('click', async () => {
    const qty = parseInt(document.getElementById('qty-input').value) || 1;
    await startCheckout(qty);
  });

  async function startCheckout(quantity) {
    if (!stripe) {
      alert('Stripe not configured. Add stripePublishableKey to config.js');
      return;
    }
    if (!supabase) {
      alert('Supabase not configured');
      return;
    }

    try {
      // Call your server API to create a Checkout Session
      const res = await fetch(cfg.apiBase + '/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: quantity,
          pricePerLot: PRICE,
          userId: currentUser.id,
          lotNumbers: Array.from(selectedLots).slice(0, quantity)
        })
      });
      const { sessionId, error } = await res.json();
      if (error) { alert(error); return; }
      const { error: stripeError } = await stripe.redirectToCheckout({ sessionId });
      if (stripeError) alert(stripeError.message);
    } catch(e) {
      alert('Checkout error: ' + e.message);
    }
  }

  // ── Media Close ──
  document.getElementById('media-close')?.addEventListener('click', () => {
    document.getElementById('grid-overlay').style.display = 'none';
  });

  document.getElementById('grid-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'grid-overlay') {
      document.getElementById('grid-overlay').style.display = 'none';
    }
  });

  // ── Initialize ──
  document.addEventListener('DOMContentLoaded', init);
})();
