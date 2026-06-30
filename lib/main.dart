import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:web/web.dart' as web;

void main() {
  runApp(const EndlessMetricsAdmin());
}

class EndlessMetricsAdmin extends StatelessWidget {
  const EndlessMetricsAdmin({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EndlessMetrics Admin',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff0f766e)),
        useMaterial3: true,
      ),
      home: const AdminHome(),
    );
  }
}

class AdminHome extends StatefulWidget {
  const AdminHome({super.key});

  @override
  State<AdminHome> createState() => _AdminHomeState();
}

class _AdminHomeState extends State<AdminHome> {
  static const defaultApiBase = 'https://unng.ru';

  final apiBaseController = TextEditingController();
  final orgNameController = TextEditingController(text: 'New organization');
  final projectNameController = TextEditingController(
    text: 'New analytics project',
  );
  final projectDomainController = TextEditingController(text: 'example.com');
  final goalNameController = TextEditingController(text: 'lead_form_submit');

  String apiBase = defaultApiBase;
  String token = '';
  String selectedTab = 'dashboard';
  String selectedOrgId = '';
  String selectedProjectId = '';
  String selectedCounterId = '';
  String status = '';
  bool loading = false;

  Map<String, dynamic>? user;
  List<dynamic> organizations = [];
  List<dynamic> projects = [];
  List<dynamic> counters = [];
  List<dynamic> goals = [];
  List<dynamic> debugEvents = [];
  List<dynamic> auditLog = [];
  Map<String, dynamic> overview = {};
  Map<String, dynamic> reports = {};

  @override
  void initState() {
    super.initState();
    final uri = Uri.base;
    apiBase =
        uri.queryParameters['api'] ??
        web.window.localStorage.getItem('em_api_base') ??
        defaultApiBase;
    apiBaseController.text = apiBase;
    selectedTab = web.window.localStorage.getItem('em_tab') ?? 'dashboard';
    selectedOrgId = web.window.localStorage.getItem('em_org_id') ?? '';
    selectedProjectId = web.window.localStorage.getItem('em_project_id') ?? '';
    selectedCounterId = web.window.localStorage.getItem('em_counter_id') ?? '';
    token = _tokenFromFragment(uri.fragment);
    if (token.isNotEmpty) {
      web.window.sessionStorage.setItem('em_token', token);
      web.window.history.replaceState(
        null,
        'EndlessMetrics Admin',
        uri.removeFragment().toString(),
      );
    } else {
      token = web.window.sessionStorage.getItem('em_token') ?? '';
    }
    if (token.isNotEmpty) {
      _loadAll();
    }
  }

  @override
  void dispose() {
    apiBaseController.dispose();
    orgNameController.dispose();
    projectNameController.dispose();
    projectDomainController.dispose();
    goalNameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Row(
        children: [
          _Sidebar(
            selectedTab: selectedTab,
            userEmail: user?['email']?.toString() ?? 'Not signed in',
            onTab: (tab) async {
              setState(() => selectedTab = tab);
              _savePrefs();
              if (token.isNotEmpty && selectedProjectId.isNotEmpty) {
                await _loadProjectData();
              }
            },
          ),
          Expanded(
            child: Column(
              children: [
                _TopBar(
                  apiBaseController: apiBaseController,
                  status: status,
                  loading: loading,
                  onSaveApi: () {
                    setState(() {
                      apiBase = apiBaseController.text.trim();
                      status = 'API base saved';
                    });
                    _savePrefs();
                  },
                  onOAuthLogin: _oauthLogin,
                  onLogout: token.isEmpty ? null : _logout,
                ),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(24),
                    child: token.isEmpty ? _loginView() : _contentView(),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _loginView() {
    return _Panel(
      title: 'Admin access',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'The admin panel uses only the configured OAuth 2.0 / OpenID Connect provider.',
          ),
          const SizedBox(height: 12),
          Text('Backend: $apiBase'),
          const SizedBox(height: 16),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              FilledButton.icon(
                key: const ValueKey('oauth-login'),
                onPressed: _oauthLogin,
                icon: const Icon(Icons.login),
                label: const Text('Sign in with OAuth 2.0'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('check-backend'),
                onPressed: _checkBackend,
                icon: const Icon(Icons.health_and_safety_outlined),
                label: const Text('Check backend'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _contentView() {
    switch (selectedTab) {
      case 'setup':
        return _setupView();
      case 'reports':
        return _reportsView();
      case 'debug':
        return _debugView();
      case 'goals':
        return _goalsView();
      case 'security':
        return _securityView();
      default:
        return _dashboardView();
    }
  }

  Widget _dashboardView() {
    final project = _selectedProject();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Panel(
          title: project?['name']?.toString() ?? 'No project selected',
          child: Text(
            project == null
                ? 'Create or select a project on the Setup screen.'
                : 'Domain: ${project['domain']}',
          ),
        ),
        const SizedBox(height: 16),
        _MetricGrid(
          values: {
            'Visits': '${overview['visits'] ?? 0}',
            'Visitors': '${overview['visitors'] ?? 0}',
            'Pageviews': '${overview['pageviews'] ?? 0}',
            'Goals': '${overview['goals'] ?? 0}',
            'Conversion': '${_round(overview['conversion_rate'])}%',
            'Bounce rate': '${_round(overview['bounce_rate'])}%',
          },
        ),
      ],
    );
  }

  Widget _setupView() {
    final counter = _selectedCounter();
    return Column(
      children: [
        _Panel(
          title: 'Organization',
          child: _FormWrap(
            children: [
              _TextInput(
                label: 'Name',
                controller: orgNameController,
                keyName: 'org-name',
              ),
              FilledButton(
                key: const ValueKey('create-org'),
                onPressed: _createOrganization,
                child: const Text('Create organization'),
              ),
              SelectableText(
                'Current: ${selectedOrgId.isEmpty ? 'none' : selectedOrgId}',
                key: const ValueKey('current-org'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _Panel(
          title: 'Project',
          child: _FormWrap(
            children: [
              _TextInput(
                label: 'Name',
                controller: projectNameController,
                keyName: 'project-name',
              ),
              _TextInput(
                label: 'Domain',
                controller: projectDomainController,
                keyName: 'project-domain',
              ),
              FilledButton(
                key: const ValueKey('create-project'),
                onPressed: _createProject,
                child: const Text('Create project'),
              ),
              SelectableText(
                'Current: ${selectedProjectId.isEmpty ? 'none' : selectedProjectId}',
                key: const ValueKey('current-project'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _Panel(
          title: 'Counter',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              FilledButton(
                key: const ValueKey('create-counter'),
                onPressed: _createCounter,
                child: const Text('Create counter'),
              ),
              const SizedBox(height: 12),
              SelectableText(
                'Counter id: ${counter?['id'] ?? ''}',
                key: const ValueKey('counter-id'),
              ),
              SelectableText(
                'Public key: ${counter?['public_key'] ?? ''}',
                key: const ValueKey('counter-public-key'),
              ),
              const SizedBox(height: 12),
              SelectableText(
                _snippet(counter?['public_key']?.toString() ?? ''),
                key: const ValueKey('snippet'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _reportsView() {
    return Column(
      children: [
        _Panel(
          title: 'Reports',
          child: Wrap(
            spacing: 10,
            children: [
              OutlinedButton.icon(
                key: const ValueKey('refresh'),
                onPressed: _loadAll,
                icon: const Icon(Icons.refresh),
                label: const Text('Refresh'),
              ),
              OutlinedButton.icon(
                onPressed: selectedProjectId.isEmpty
                    ? null
                    : () => web.window.open(
                        '$apiBase/api/v1/reports/export.csv?project_id=$selectedProjectId',
                        '_blank',
                      ),
                icon: const Icon(Icons.download),
                label: const Text('CSV export'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _TablePanel(
          title: 'Sources',
          rows: _reportRows('sources', 'sources'),
          columns: const [
            'source',
            'medium',
            'campaign',
            'visits',
            'pageviews',
            'goals',
          ],
        ),
        _TablePanel(
          title: 'Pages',
          rows: _reportRows('pages', 'pages'),
          columns: const [
            'url',
            'views',
            'unique_visitors',
            'entrances',
            'exits',
            'goals',
          ],
        ),
        _TablePanel(
          title: 'Events',
          rows: _reportRows('events', 'events'),
          columns: const [
            'type',
            'name',
            'count',
            'unique_users',
            'sessions',
            'goals_triggered',
          ],
        ),
        _TablePanel(
          title: 'Goals report',
          rows: _reportRows('goals', 'goals'),
          columns: const [
            'name',
            'visits',
            'completions',
            'unique_users',
            'conversion_rate',
            'revenue',
          ],
        ),
      ],
    );
  }

  Widget _debugView() {
    return _TablePanel(
      title: 'Debug events',
      rows: debugEvents,
      columns: const [
        'server_time',
        'type',
        'name',
        'url',
        'traffic_source',
        'ip_hash',
      ],
      refresh: _loadProjectData,
    );
  }

  Widget _goalsView() {
    return Column(
      children: [
        _Panel(
          title: 'Create goal',
          child: _FormWrap(
            children: [
              _TextInput(
                label: 'Name',
                controller: goalNameController,
                keyName: 'goal-name',
              ),
              FilledButton(
                key: const ValueKey('create-goal'),
                onPressed: _createGoal,
                child: const Text('Create goal'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _TablePanel(
          title: 'Goals',
          rows: goals,
          columns: const ['name', 'type', 'enabled', 'value', 'currency'],
        ),
      ],
    );
  }

  Widget _securityView() {
    return Column(
      children: [
        _Panel(
          title: 'API tokens and audit',
          child: FilledButton(
            key: const ValueKey('create-api-token'),
            onPressed: _createApiToken,
            child: const Text('Create API token'),
          ),
        ),
        const SizedBox(height: 16),
        _TablePanel(
          title: 'Audit log',
          rows: auditLog,
          columns: const [
            'created_at',
            'actor_user_id',
            'action',
            'entity_type',
            'entity_id',
          ],
        ),
      ],
    );
  }

  Future<void> _oauthLogin() async {
    apiBase = apiBaseController.text.trim();
    _savePrefs();
    final login = Uri.parse('$apiBase/auth/login').replace(
      queryParameters: {
        'redirect_to': Uri.base.removeFragment().toString(),
        'token_redirect': '1',
      },
    );
    web.window.location.assign(login.toString());
  }

  Future<void> _logout() async {
    try {
      await _post('/api/v1/logout', {});
    } catch (_) {}
    web.window.sessionStorage.removeItem('em_token');
    setState(() {
      token = '';
      user = null;
      status = 'Signed out';
    });
  }

  Future<void> _checkBackend() async {
    await _withLoading(() async {
      await _get('/healthz');
      status = 'Backend is reachable';
    });
  }

  Future<void> _createOrganization() async {
    await _withLoading(() async {
      final org = await _post('/api/v1/organizations', {
        'name': orgNameController.text.trim(),
      });
      selectedOrgId = org['organization']['id'];
      await _loadAll(setLoading: false);
    });
  }

  Future<void> _createProject() async {
    await _withLoading(() async {
      final domain = projectDomainController.text.trim();
      final project = await _post('/api/v1/projects', {
        'organization_id': selectedOrgId,
        'name': projectNameController.text.trim(),
        'domain': domain,
        'allowed_domains': [domain],
      });
      selectedProjectId = project['project']['id'];
      await _loadAll(setLoading: false);
    });
  }

  Future<void> _createCounter() async {
    await _withLoading(() async {
      final counter = await _post(
        '/api/v1/projects/$selectedProjectId/counters',
        {'name': 'Main counter'},
      );
      selectedCounterId = counter['counter']['id'];
      await _loadAll(setLoading: false);
    });
  }

  Future<void> _createGoal() async {
    await _withLoading(() async {
      await _post('/api/v1/projects/$selectedProjectId/goals', {
        'name': goalNameController.text.trim(),
        'type': 'js_goal',
        'conditions': {},
      });
      await _loadAll(setLoading: false);
    });
  }

  Future<void> _createApiToken() async {
    await _withLoading(() async {
      final body = await _post(
        '/api/v1/api-tokens?project_id=$selectedProjectId',
        {'name': 'Admin token'},
      );
      status = 'API token: ${body['token']}';
    });
  }

  Future<void> _loadAll({bool setLoading = true}) async {
    final action = () async {
      final me = await _get('/api/v1/me');
      user = me['user'];
      organizations = me['organizations'] ?? [];
      final projectsBody = await _get('/api/v1/projects');
      projects = projectsBody['projects'] ?? [];
      if (!organizations.any((org) => org['id'] == selectedOrgId)) {
        selectedOrgId = organizations.isEmpty ? '' : organizations.first['id'];
      }
      if (!projects.any((project) => project['id'] == selectedProjectId)) {
        selectedProjectId = projects.isEmpty ? '' : projects.first['id'];
      }
      await _loadProjectData(setLoading: false);
      _savePrefs();
    };
    if (setLoading) {
      await _withLoading(action);
    } else {
      await action();
    }
  }

  Future<void> _loadProjectData({bool setLoading = true}) async {
    if (selectedProjectId.isEmpty) {
      setState(() {});
      return;
    }
    final action = () async {
      final responses = await Future.wait([
        _get('/api/v1/projects/$selectedProjectId/counters'),
        _get('/api/v1/projects/$selectedProjectId/goals'),
        _get('/api/v1/reports/overview?project_id=$selectedProjectId'),
        _get('/api/v1/debug/events?project_id=$selectedProjectId'),
        _get('/api/v1/reports/sources?project_id=$selectedProjectId'),
        _get('/api/v1/reports/pages?project_id=$selectedProjectId'),
        _get('/api/v1/reports/events?project_id=$selectedProjectId'),
        _get('/api/v1/reports/goals?project_id=$selectedProjectId'),
        _get('/api/v1/audit-log?project_id=$selectedProjectId'),
      ]);
      counters = responses[0]['counters'] ?? [];
      goals = responses[1]['goals'] ?? [];
      overview = responses[2];
      debugEvents = responses[3]['events'] ?? [];
      reports = {
        'sources': responses[4],
        'pages': responses[5],
        'events': responses[6],
        'goals': responses[7],
      };
      auditLog = responses[8]['audit_log'] ?? [];
      if (!counters.any((counter) => counter['id'] == selectedCounterId)) {
        selectedCounterId = counters.isEmpty ? '' : counters.first['id'];
      }
      _savePrefs();
    };
    if (setLoading) {
      await _withLoading(action);
    } else {
      await action();
    }
  }

  Future<Map<String, dynamic>> _get(String path) => _request('GET', path);

  Future<Map<String, dynamic>> _post(String path, Object body) =>
      _request('POST', path, body: body);

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Object? body,
  }) async {
    final uri = Uri.parse('${apiBase.replaceFirst(RegExp(r'/$'), '')}$path');
    final headers = {'Content-Type': 'application/json'};
    if (token.isNotEmpty) headers['Authorization'] = 'Bearer $token';
    final response = method == 'POST'
        ? await http.post(uri, headers: headers, body: jsonEncode(body ?? {}))
        : await http.get(uri, headers: headers);
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(decoded['message'] ?? 'HTTP ${response.statusCode}');
    }
    return decoded;
  }

  Future<void> _withLoading(Future<void> Function() action) async {
    setState(() {
      loading = true;
      status = '';
    });
    try {
      await action();
    } catch (error) {
      status = error.toString();
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void _savePrefs() {
    web.window.localStorage.setItem('em_api_base', apiBase);
    web.window.localStorage.setItem('em_tab', selectedTab);
    if (selectedOrgId.isNotEmpty)
      web.window.localStorage.setItem('em_org_id', selectedOrgId);
    if (selectedProjectId.isNotEmpty)
      web.window.localStorage.setItem('em_project_id', selectedProjectId);
    if (selectedCounterId.isNotEmpty)
      web.window.localStorage.setItem('em_counter_id', selectedCounterId);
  }

  Map<String, dynamic>? _selectedProject() {
    for (final project in projects) {
      if (project is Map<String, dynamic> && project['id'] == selectedProjectId)
        return project;
    }
    return null;
  }

  Map<String, dynamic>? _selectedCounter() {
    for (final counter in counters) {
      if (counter is Map<String, dynamic> && counter['id'] == selectedCounterId)
        return counter;
    }
    return counters.isNotEmpty && counters.first is Map<String, dynamic>
        ? counters.first as Map<String, dynamic>
        : null;
  }

  List<dynamic> _reportRows(String reportKey, String rowKey) {
    final report = reports[reportKey];
    return report is Map<String, dynamic> && report[rowKey] is List
        ? report[rowKey] as List<dynamic>
        : [];
  }

  String _snippet(String publicKey) {
    if (publicKey.isEmpty) return '';
    return "<script async src=\"$apiBase/sdk/sma.js\"></script>\n<script>sma('init', { counterId: '$publicKey', endpoint: '$apiBase/collect', trackSpa: true }); sma('pageview');</script>";
  }

  String _tokenFromFragment(String fragment) {
    if (fragment.isEmpty) return '';
    final params = Uri.splitQueryString(
      fragment.startsWith('?') ? fragment.substring(1) : fragment,
    );
    return params['session_token'] ?? '';
  }

  String _round(dynamic value) {
    final number = value is num ? value : num.tryParse('$value') ?? 0;
    return number.toStringAsFixed(number.truncateToDouble() == number ? 0 : 2);
  }
}

class _Sidebar extends StatelessWidget {
  const _Sidebar({
    required this.selectedTab,
    required this.userEmail,
    required this.onTab,
  });

  final String selectedTab;
  final String userEmail;
  final ValueChanged<String> onTab;

  @override
  Widget build(BuildContext context) {
    const items = {
      'dashboard': 'Dashboard',
      'setup': 'Setup',
      'reports': 'Reports',
      'debug': 'Debug',
      'goals': 'Goals',
      'security': 'Security',
    };
    return Container(
      width: 260,
      color: const Color(0xff18202b),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'EndlessMetrics',
            style: TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 18),
          Text(userEmail, style: const TextStyle(color: Colors.white)),
          const SizedBox(height: 20),
          for (final entry in items.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SizedBox(
                width: double.infinity,
                child: TextButton(
                  key: ValueKey('tab-${entry.key}'),
                  style: TextButton.styleFrom(
                    alignment: Alignment.centerLeft,
                    foregroundColor: Colors.white,
                    backgroundColor: selectedTab == entry.key
                        ? const Color(0xff273345)
                        : Colors.transparent,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 14,
                    ),
                  ),
                  onPressed: () => onTab(entry.key),
                  child: Text(entry.value),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.apiBaseController,
    required this.status,
    required this.loading,
    required this.onSaveApi,
    required this.onOAuthLogin,
    required this.onLogout,
  });

  final TextEditingController apiBaseController;
  final String status;
  final bool loading;
  final VoidCallback onSaveApi;
  final VoidCallback onOAuthLogin;
  final VoidCallback? onLogout;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0xffd8dee8))),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('api-base'),
                  controller: apiBaseController,
                  decoration: const InputDecoration(
                    labelText: 'API base',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              OutlinedButton(
                onPressed: onSaveApi,
                child: const Text('Save API'),
              ),
              const SizedBox(width: 10),
              FilledButton(
                onPressed: onOAuthLogin,
                child: const Text('OAuth login'),
              ),
              if (onLogout != null) ...[
                const SizedBox(width: 10),
                OutlinedButton(
                  onPressed: onLogout,
                  child: const Text('Logout'),
                ),
              ],
            ],
          ),
          if (loading || status.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                if (loading)
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                if (loading) const SizedBox(width: 8),
                Expanded(child: Text(status, key: const ValueKey('status'))),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xffd8dee8)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.values});

  final Map<String, String> values;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        for (final entry in values.entries)
          Container(
            width: 180,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: const Color(0xffe1e7ef)),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(entry.key),
                const SizedBox(height: 8),
                Text(
                  entry.value,
                  key: ValueKey(
                    'metric-${entry.key.toLowerCase().replaceAll(' ', '-')}',
                  ),
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _FormWrap extends StatelessWidget {
  const _FormWrap({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 10,
    runSpacing: 10,
    crossAxisAlignment: WrapCrossAlignment.center,
    children: children,
  );
}

class _TextInput extends StatelessWidget {
  const _TextInput({
    required this.label,
    required this.controller,
    required this.keyName,
  });
  final String label;
  final TextEditingController controller;
  final String keyName;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 260,
      child: TextField(
        key: ValueKey(keyName),
        controller: controller,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
        ),
      ),
    );
  }
}

class _TablePanel extends StatelessWidget {
  const _TablePanel({
    required this.title,
    required this.rows,
    required this.columns,
    this.refresh,
  });

  final String title;
  final List<dynamic> rows;
  final List<String> columns;
  final Future<void> Function()? refresh;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: _Panel(
        title: title,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (refresh != null)
              OutlinedButton.icon(
                key: const ValueKey('refresh'),
                onPressed: refresh,
                icon: const Icon(Icons.refresh),
                label: const Text('Refresh'),
              ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columns: [
                  for (final column in columns) DataColumn(label: Text(column)),
                ],
                rows: [
                  for (final row in rows)
                    DataRow(
                      cells: [
                        for (final column in columns)
                          DataCell(
                            SelectableText(
                              row is Map ? '${row[column] ?? ''}' : '',
                            ),
                          ),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
