// API base URL
const API_BASE = '/api';

// State
let opportunities = [];
let stats = {};
let filters = {
    status: '',
    minProfit: null
};

// DOM Elements
const elements = {
    // Stats
    totalOpps: document.getElementById('totalOpps'),
    pendingOpps: document.getElementById('pendingOpps'),
    executedOpps: document.getElementById('executedOpps'),
    avgProfit: document.getElementById('avgProfit'),

    // Buttons
    newOppBtn: document.getElementById('newOppBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    exportCSVBtn: document.getElementById('exportCSVBtn'),
    applyFilters: document.getElementById('applyFilters'),
    clearFilters: document.getElementById('clearFilters'),

    // Filters
    statusFilter: document.getElementById('statusFilter'),
    minProfitFilter: document.getElementById('minProfitFilter'),

    // Table
    tableBody: document.getElementById('opportunitiesTableBody'),

    // Modals
    oppModal: document.getElementById('oppModal'),
    detailModal: document.getElementById('detailModal'),
    oppForm: document.getElementById('oppForm'),
    detailContent: document.getElementById('detailContent'),

    // Modal controls
    closeModal: document.querySelector('#oppModal .close'),
    closeDetail: document.getElementById('closeDetail'),
    closeDetailBtn: document.getElementById('closeDetailBtn'),
    cancelBtn: document.getElementById('cancelBtn')
};

// Initialize app
async function init() {
    setupEventListeners();
    await loadStats();
    await loadOpportunities();
}

// Event Listeners
function setupEventListeners() {
    elements.newOppBtn.addEventListener('click', () => openModal());
    elements.refreshBtn.addEventListener('click', () => loadOpportunities());
    elements.exportCSVBtn.addEventListener('click', () => exportCSV());
    elements.applyFilters.addEventListener('click', () => applyFilters());
    elements.clearFilters.addEventListener('click', () => clearFilters());

    elements.oppForm.addEventListener('submit', handleFormSubmit);

    // Modal controls
    elements.closeModal.addEventListener('click', () => closeModal());
    elements.closeDetail.addEventListener('click', () => closeDetailModal());
    elements.closeDetailBtn.addEventListener('click', () => closeDetailModal());
    elements.cancelBtn.addEventListener('click', () => closeModal());

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === elements.oppModal) closeModal();
        if (e.target === elements.detailModal) closeDetailModal();
    });
}

// API Functions
async function fetchAPI(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        showNotification('Error: ' + error.message, 'error');
        throw error;
    }
}

async function loadStats() {
    try {
        const response = await fetchAPI('/opportunities/stats');
        if (response.success) {
            stats = response.data;
            updateStatsDisplay();
        }
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

async function loadOpportunities() {
    try {
        let endpoint = '/opportunities?limit=100';

        if (filters.status) {
            endpoint += `&status=${filters.status}`;
        }

        if (filters.minProfit !== null && filters.minProfit > 0) {
            endpoint += `&minProfit=${filters.minProfit}`;
        }

        const response = await fetchAPI(endpoint);

        if (response.success) {
            opportunities = response.data.opportunities;
            renderOpportunities();
        }
    } catch (error) {
        console.error('Failed to load opportunities:', error);
        elements.tableBody.innerHTML = '<tr><td colspan="9" class="no-data">Failed to load opportunities</td></tr>';
    }
}

async function createOpportunity(data) {
    try {
        const response = await fetchAPI('/opportunities', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        if (response.success) {
            showNotification('Opportunity created successfully!', 'success');
            closeModal();
            await loadStats();
            await loadOpportunities();
        }
    } catch (error) {
        console.error('Failed to create opportunity:', error);
    }
}

async function deleteOpportunity(id) {
    if (!confirm('Are you sure you want to delete this opportunity?')) {
        return;
    }

    try {
        const response = await fetchAPI(`/opportunities/${id}`, {
            method: 'DELETE'
        });

        if (response.success) {
            showNotification('Opportunity deleted successfully!', 'success');
            await loadStats();
            await loadOpportunities();
        }
    } catch (error) {
        console.error('Failed to delete opportunity:', error);
    }
}

async function viewOpportunityDetails(id) {
    try {
        const response = await fetchAPI(`/opportunities/${id}`);

        if (response.success) {
            displayOpportunityDetails(response.data);
            elements.detailModal.classList.add('active');
        }
    } catch (error) {
        console.error('Failed to load opportunity details:', error);
    }
}

function exportCSV() {
    let url = `${API_BASE}/opportunities/export/csv?limit=1000`;

    if (filters.status) {
        url += `&status=${filters.status}`;
    }

    if (filters.minProfit !== null && filters.minProfit > 0) {
        url += `&minProfit=${filters.minProfit}`;
    }

    window.location.href = url;
    showNotification('Exporting CSV...', 'success');
}

// Display Functions
function updateStatsDisplay() {
    elements.totalOpps.textContent = stats.total || 0;
    elements.pendingOpps.textContent = stats.pending || 0;
    elements.executedOpps.textContent = stats.executed || 0;
    elements.avgProfit.textContent = '$' + (stats.avgProfit || 0).toFixed(2);
}

function renderOpportunities() {
    if (opportunities.length === 0) {
        elements.tableBody.innerHTML = '<tr><td colspan="9" class="no-data">No opportunities found</td></tr>';
        return;
    }

    const rows = opportunities.map(opp => {
        const createdDate = new Date(opp.created_at);
        const statusClass = `status-${opp.status || 'pending'}`;

        return `
            <tr>
                <td class="truncate" title="${opp.id}">${opp.id.substring(0, 8)}...</td>
                <td class="truncate" title="${opp.token_in}">${formatAddress(opp.token_in)}</td>
                <td class="truncate" title="${opp.token_out}">${formatAddress(opp.token_out)}</td>
                <td>${formatAmount(opp.amount_in)}</td>
                <td>$${opp.profit_usd.toFixed(2)}</td>
                <td>${opp.profit_percentage.toFixed(2)}%</td>
                <td><span class="status-badge ${statusClass}">${opp.status || 'pending'}</span></td>
                <td>${createdDate.toLocaleString()}</td>
                <td>
                    <button class="btn btn-sm btn-primary action-btn" onclick="viewOpportunityDetails('${opp.id}')">View</button>
                    <button class="btn btn-sm btn-danger action-btn" onclick="deleteOpportunity('${opp.id}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');

    elements.tableBody.innerHTML = rows;
}

function displayOpportunityDetails(opp) {
    const createdDate = new Date(opp.created_at);
    const expiresDate = new Date(opp.expires_at);
    const executedDate = opp.executed_at ? new Date(opp.executed_at) : null;

    let route = '[]';
    try {
        route = JSON.stringify(JSON.parse(opp.route), null, 2);
    } catch (e) {
        route = opp.route;
    }

    elements.detailContent.innerHTML = `
        <div class="detail-row">
            <div class="detail-label">ID</div>
            <div class="detail-value">${opp.id}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Chain ID</div>
            <div class="detail-value">${opp.chain_id}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Token In</div>
            <div class="detail-value">${opp.token_in}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Token Out</div>
            <div class="detail-value">${opp.token_out}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Amount In</div>
            <div class="detail-value">${opp.amount_in}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Amount Out (Predicted)</div>
            <div class="detail-value">${opp.amount_out_predicted}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Profit USD</div>
            <div class="detail-value">$${opp.profit_usd.toFixed(2)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Profit Percentage</div>
            <div class="detail-value">${opp.profit_percentage.toFixed(2)}%</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Status</div>
            <div class="detail-value"><span class="status-badge status-${opp.status}">${opp.status}</span></div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Created At</div>
            <div class="detail-value">${createdDate.toLocaleString()}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Expires At</div>
            <div class="detail-value">${expiresDate.toLocaleString()}</div>
        </div>
        ${executedDate ? `
        <div class="detail-row">
            <div class="detail-label">Executed At</div>
            <div class="detail-value">${executedDate.toLocaleString()}</div>
        </div>
        ` : ''}
        <div class="detail-row">
            <div class="detail-label">Route</div>
            <div class="detail-value"><pre style="margin: 0; font-size: 0.75rem;">${route}</pre></div>
        </div>
    `;
}

// Helper Functions
function formatAddress(address) {
    if (!address || address.length < 10) return address;
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

function formatAmount(amount) {
    if (!amount) return '0';
    const num = parseFloat(amount);
    if (num > 1e15) {
        return (num / 1e18).toFixed(4);
    }
    return num.toFixed(4);
}

function showNotification(message, type = 'info') {
    // Simple notification - you can enhance this with a toast library
    console.log(`[${type.toUpperCase()}] ${message}`);

    // Create a simple notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#2563eb'};
        color: white;
        border-radius: 0.5rem;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        z-index: 9999;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Modal Functions
function openModal() {
    elements.oppModal.classList.add('active');
    elements.oppForm.reset();
}

function closeModal() {
    elements.oppModal.classList.remove('active');
}

function closeDetailModal() {
    elements.detailModal.classList.remove('active');
}

// Form Handler
async function handleFormSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const data = {};

    for (let [key, value] of formData.entries()) {
        if (key === 'chain_id' || key === 'expires_in') {
            data[key] = parseInt(value);
        } else if (key === 'profit_usd' || key === 'profit_percentage') {
            data[key] = parseFloat(value) || 0;
        } else {
            data[key] = value;
        }
    }

    // Handle expires_in conversion to expires_at
    if (data.expires_in) {
        data.expires_at = Date.now() + (data.expires_in * 1000);
        delete data.expires_in;
    }

    // Validate and format route
    if (data.route) {
        try {
            JSON.parse(data.route);
        } catch (e) {
            data.route = JSON.stringify([]);
        }
    } else {
        data.route = JSON.stringify([]);
    }

    await createOpportunity(data);
}

// Filter Functions
function applyFilters() {
    filters.status = elements.statusFilter.value;
    filters.minProfit = parseFloat(elements.minProfitFilter.value) || null;
    loadOpportunities();
}

function clearFilters() {
    filters = { status: '', minProfit: null };
    elements.statusFilter.value = '';
    elements.minProfitFilter.value = '';
    loadOpportunities();
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Start the app
init();
