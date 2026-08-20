document.addEventListener('alpine:init', () => {
    Alpine.data('boardApp', () => ({
        token: localStorage.getItem('token') || '',
        user: null,
        users: [],
        tickets: [],
        isRegister: false,
        showCreateModal: false,
        selectedTicket: null,
        singleTicketView: null,

        authForm: { email: '', password: '', fullName: '' },
        newTicket: { title: '', type: 'Task', assignee_id: '', description: '' },

        columns: [
            'ToDo', 'In progress', 'ready for testing',
            'testing', 'ready for deploy', 'deployed', 'done'
        ],

        async init() {
            if (this.token) {
                await this.fetchUser();
                await this.fetchUsers();

                // Перевірка чи відкрита конкретна картка в новій вкладці через URL
                const urlParams = new URLSearchParams(window.location.search);
                const ticketKey = urlParams.get('ticket');

                if (ticketKey) {
                    await this.fetchSingleTicket(ticketKey);
                } else {
                    await this.fetchTickets();
                    this.$nextTick(() => this.initSortable());
                }
            }
        },

        async authSubmit() {
            const endpoint = this.isRegister ? '/api/auth/register' : '/api/auth/login';
            let body;

            if (this.isRegister) {
                body = JSON.stringify({
                    email: this.authForm.email,
                    password: this.authForm.password,
                    full_name: this.authForm.fullName
                });
            } else {
                body = new URLSearchParams({
                    username: this.authForm.email,
                    password: this.authForm.password
                });
            }

            const headers = this.isRegister ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/x-www-form-urlencoded' };

            const res = await fetch(endpoint, { method: 'POST', headers, body });
            if (res.ok) {
                if (this.isRegister) {
                    this.isRegister = false;
                    alert('Реєстрація успішна! Увійдіть.');
                } else {
                    const data = await res.json();
                    this.token = data.access_token;
                    localStorage.setItem('token', this.token);
                    await this.init();
                }
            } else {
                alert('Помилка авторизації');
            }
        },

        async fetchUser() {
            const res = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${this.token}` } });
            if (res.ok) this.user = await res.json();
            else this.logout();
        },

        async fetchUsers() {
            const res = await fetch('/api/auth/users', { headers: { 'Authorization': `Bearer ${this.token}` } });
            if (res.ok) this.users = await res.json();
        },

        async fetchTickets() {
            const res = await fetch('/api/tickets', { headers: { 'Authorization': `Bearer ${this.token}` } });
            if (res.ok) this.tickets = await res.json();
        },

        async fetchSingleTicket(key) {
            const res = await fetch(`/api/tickets/key/${key}`, { headers: { 'Authorization': `Bearer ${this.token}` } });
            if (res.ok) {
                this.singleTicketView = await res.json();
            } else {
                alert('Тікет не знайдено');
                window.location.href = '/';
            }
        },

        openTicketModal(ticket) {
            this.selectedTicket = ticket;
        },

        getTicketsByStatus(status) {
            return this.tickets.filter(t => t.status === status);
        },

        async createTicket() {
            const payload = {
                title: this.newTicket.title,
                type: this.newTicket.type,
                description: this.newTicket.description || null,
                assignee_id: this.newTicket.assignee_id ? parseInt(this.newTicket.assignee_id) : null
            };

            const res = await fetch('/api/tickets', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                this.showCreateModal = false;
                this.newTicket = { title: '', type: 'Task', assignee_id: '', description: '' };
                await this.fetchTickets();
            }
        },

        initSortable() {
            const cols = document.querySelectorAll('.kanban-col');
            cols.forEach(col => {
                new Sortable(col, {
                    group: 'kanban',
                    animation: 150,
                    onEnd: async (evt) => {
                        const ticketId = evt.item.dataset.id;
                        const newStatus = evt.to.dataset.status;

                        await fetch(`/api/tickets/${ticketId}/status`, {
                            method: 'PATCH',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.token}`
                            },
                            body: JSON.stringify({ status: newStatus })
                        });
                        await this.fetchTickets();
                    }
                });
            });
        },

        async updateTicket() {
            const payload = {
                status: this.selectedTicket.status,
                assignee_id: this.selectedTicket.assignee_id ? parseInt(this.selectedTicket.assignee_id) : null,
                description: this.selectedTicket.description
            };

            const res = await fetch(`/api/tickets/${this.selectedTicket.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                this.selectedTicket = null;
                await this.fetchTickets(); // Оновлюємо дошку
            } else {
                alert('Помилка збереження');
            }
        },

        logout() {
            localStorage.removeItem('token');
            this.token = '';
            this.user = null;
        }
    }));
});