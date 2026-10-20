import 'dart:async';
import 'dart:ui' show AppExitResponse;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'core/models.dart';
import 'core/repository.dart';
import 'l10n.dart';
import 'store.dart';
import 'platform/browser_hooks.dart';
import 'platform/browser_backend.dart';
import 'platform/journal_actions.dart';
import 'ui/dashboard.dart';
import 'ui/habit_card.dart';
import 'ui/habit_editor.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('en_US');
  await initializeDateFormatting('zh_CN');
  try {
    final store = RhythmStore(JournalRepository(createJournalBackend()));
    await store.load();
    runApp(RhythmApp(store: store));
  } catch (_) {
    runApp(
      MaterialApp(
        theme: RhythmTheme.data,
        home: const Scaffold(
          body: Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: Text('Rhythm could not load. Please reload this page.'),
            ),
          ),
        ),
      ),
    );
  }
}

class RhythmApp extends StatelessWidget {
  const RhythmApp({super.key, required this.store});
  final RhythmStore store;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: store,
    builder: (context, _) => MaterialApp(
      debugShowCheckedModeBanner: false,
      title: store.strings.t('Rhythm', '律动'),
      theme: RhythmTheme.data,
      locale: store.language.locale,
      supportedLocales: const [
        Locale('en', 'US'),
        Locale.fromSubtags(
          languageCode: 'zh',
          scriptCode: 'Hans',
          countryCode: 'CN',
        ),
      ],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: RhythmHome(store: store),
    ),
  );
}

class RhythmHome extends StatefulWidget {
  const RhythmHome({super.key, required this.store});
  final RhythmStore store;
  @override
  State<RhythmHome> createState() => _RhythmHomeState();
}

class _RhythmHomeState extends State<RhythmHome> with WidgetsBindingObserver {
  int _tab = 0;
  bool _showArchive = false;
  late final Timer _calendarTimer;
  final _scroll = List.generate(3, (_) => ScrollController());
  RhythmStore get store => widget.store;
  Strings get s => store.strings;
  List<String> get _tabs => [
    s.t('Journal', '日记'),
    s.t('Statistics', '统计'),
    s.t('My habits', '我的习惯'),
  ];
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    attachBrowserHooks(
      (name, input) => runJournalAction(
        store,
        name,
        input,
        openDay: _openDay,
        startCreation: () => unawaited(_edit()),
      ),
    );
    store.addListener(_updateBrowserStatus);
    _updateBrowserStatus();
    _calendarTimer = Timer.periodic(
      const Duration(minutes: 1),
      (_) => store.refreshCalendar(),
    );
  }

  @override
  void dispose() {
    store.removeListener(_updateBrowserStatus);
    detachBrowserHooks();
    _calendarTimer.cancel();
    WidgetsBinding.instance.removeObserver(this);
    for (final controller in _scroll) {
      controller.dispose();
    }
    super.dispose();
  }

  void _updateBrowserStatus() =>
      setBrowserUnsaved(store.saving || store.hasUnsavedChanges);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) store.refreshCalendar();
  }

  @override
  Future<AppExitResponse> didRequestAppExit() async {
    if (store.saving || store.hasUnsavedChanges) {
      _message(
        s.t(
          'Please keep Rhythm open until your changes are saved. Retry saving or export a backup if needed.',
          '请保持应用开启，直到更改保存完成。必要时重试保存或导出备份。',
        ),
      );
      return AppExitResponse.cancel;
    }
    return AppExitResponse.exit;
  }

  void _navigate(int index) {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _tab = index);
  }

  void _openDay(String day) {
    store.selectDay(day);
    _navigate(0);
    if (_scroll[0].hasClients) _scroll[0].jumpTo(0);
  }

  Future<void> _edit([Habit? habit]) async {
    if (!store.ready || store.importing) return;
    final value = await showHabitEditor(
      context,
      habit: habit,
      initialDay: store.isFuture ? store.today : store.selectedDay,
      strings: s,
    );
    if (value != null) await store.saveHabit(value);
  }

  Future<void> _delete(Habit habit) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          s.t('Delete this habit and its history?', '删除此习惯及其全部历史记录？'),
        ),
        content: Text(
          s.t(
            '“${habit.title}” and all its daily entries will be deleted. This cannot be undone.',
            '“${habit.title}”及其所有每日记录都将被删除。此操作无法撤销。',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(s.t('Cancel', '取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(s.t('Delete', '删除')),
          ),
        ],
      ),
    );
    if (confirmed == true) await store.deleteHabit(habit);
  }

  Future<void> _archive(Habit habit) async {
    if (!await store.archiveHabit(habit) || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          s.t(
            '“${habit.title}” moved to the archive. History kept.',
            '“${habit.title}”已归档，历史记录已保留。',
          ),
        ),
        action: SnackBarAction(
          label: s.t('Undo', '撤销'),
          onPressed: () => unawaited(_restore(habit)),
        ),
      ),
    );
  }

  Future<void> _restore(Habit habit) async {
    if (await store.unarchiveHabit(habit)) {
      _message(
        s.t(
          '“${habit.title}” restored to active habits.',
          '“${habit.title}”已恢复为活跃习惯。',
        ),
      );
    }
  }

  void _message(String value) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }

  Future<void> _export() async {
    if (!store.ready) return;
    try {
      final json = JournalRepository.encode(store.journal);
      if (downloadBackup('rhythm-${store.today}.json', json)) {
        _message(
          s.t(
            'Backup download started. Check your browser downloads.',
            '备份下载已开始。请查看浏览器下载列表。',
          ),
        );
        return;
      }
    } catch (error) {
      store.reportError(error);
    }
  }

  Future<void> _import() async {
    if (store.saving || store.hasUnsavedChanges || store.importing) {
      _message(
        s.t(
          'Save or export your pending changes before importing.',
          '请先保存或导出尚未保存的更改。',
        ),
      );
      return;
    }
    try {
      final contents = await pickBackup();
      if (contents == null) return;
      final imported = JournalRepository.decode(contents);
      if (!mounted) return;
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(s.t('Replace current data?', '替换当前数据？')),
          content: Text(
            s.t(
              'Backup: ${imported.habits.length} habits, ${imported.entries.length} entries. This replaces your account journal in every browser. The current version will be kept as the previous backup.',
              '备份包含 ${imported.habits.length} 个习惯、${imported.entries.length} 条记录。这将替换所有浏览器中的账号日记，当前版本会保留为上一份备份。',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(s.t('Cancel', '取消')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(s.t('Restore backup', '恢复备份')),
            ),
          ],
        ),
      );
      if (confirmed == true && await store.importJournal(imported)) {
        _message(s.t('Backup restored.', '备份已恢复。'));
      }
    } catch (error) {
      store.reportError(error);
    }
  }

  Future<void> _reloadSaved() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(s.t('Load the saved version?', '加载已保存的版本？')),
        content: Text(
          s.t(
            'Unsaved changes in this tab will be discarded. Export your draft as JSON first if you want to keep it.',
            '此标签页中未保存的更改将被丢弃。如需保留，请先将草稿导出为 JSON。',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(s.t('Cancel', '取消')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(s.t('Load saved', '加载已保存版本')),
          ),
        ],
      ),
    );
    if (confirmed == true) await store.reloadSaved();
  }

  Future<void> _exportPrevious() async {
    try {
      final json = await store.repository.previousSnapshot();
      if (json == null) {
        _message(s.t('No previous saved version yet.', '暂无之前保存的版本。'));
        return;
      }
      downloadBackup('rhythm-previous-${store.today}.json', json);
      _message(s.t('Previous JSON download started.', '之前版本的 JSON 下载已开始。'));
    } catch (error) {
      store.reportError(error);
    }
  }

  void _storageInfo() => showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(s.t('Saved to your account', '已保存到账号')),
      content: Text(
        s.t(
          'Your journal is saved to your account on the server. Sign in to the same account in another browser to open it. Reload to see changes made elsewhere. Export JSON keeps a separate backup. Saving requires a connection; keep this tab open if changes are not saved.',
          '日记会保存到服务器上的账号中。在其他浏览器登录同一账号即可查看。刷新页面可查看其他设备的更改。“导出 JSON”可保留单独的备份。保存需要网络连接；更改尚未保存时请保持此标签页开启。',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(s.t('Got it', '知道了')),
        ),
      ],
    ),
  );

  Widget _languageMenu({bool compact = false}) => PopupMenuButton<AppLanguage>(
    tooltip: s.t('Language', '语言'),
    constraints: const BoxConstraints(minWidth: 180),
    onSelected: (value) => unawaited(store.setLanguage(value)),
    itemBuilder: (_) => AppLanguage.values
        .map(
          (value) => CheckedPopupMenuItem(
            value: value,
            checked: value == store.language,
            child: Text(value.nativeName),
          ),
        )
        .toList(),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.language, size: 19, color: RhythmTheme.accent),
          if (!compact) ...[
            const SizedBox(width: 9),
            Text(
              store.language.nativeName,
              style: RhythmTheme.mono(12, color: RhythmTheme.accent),
            ),
            const Icon(Icons.expand_more, size: 18, color: RhythmTheme.accent),
          ],
        ],
      ),
    ),
  );
  Widget _backupMenu({bool compact = false}) => PopupMenuButton<String>(
    tooltip: s.t('Backup', '备份'),
    onSelected: (value) {
      switch (value) {
        case 'export':
          _export();
        case 'previous':
          _exportPrevious();
        case 'import':
          _import();
        case 'storage':
          _storageInfo();
        case 'logout':
          unawaited(signOut());
      }
    },
    itemBuilder: (_) => [
      PopupMenuItem(
        value: 'export',
        enabled: store.ready,
        child: Text(s.t('Export JSON…', '导出 JSON…')),
      ),
      PopupMenuItem(
        value: 'import',
        enabled: !store.importing && !store.saving && !store.hasUnsavedChanges,
        child: Text(s.t('Restore from JSON…', '从 JSON 恢复…')),
      ),
      PopupMenuItem(
        value: 'previous',
        child: Text(s.t('Export previous JSON…', '导出之前的 JSON…')),
      ),
      const PopupMenuDivider(),
      PopupMenuItem(
        value: 'storage',
        child: Text(s.t('About account storage', '关于账号存储')),
      ),
      const PopupMenuDivider(),
      PopupMenuItem(
        value: 'logout',
        enabled: !store.saving && !store.hasUnsavedChanges,
        child: Text(s.t('Sign out', '退出登录')),
      ),
    ],
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.inventory_2_outlined,
            size: 19,
            color: RhythmTheme.accent,
          ),
          if (!compact) ...[
            const SizedBox(width: 9),
            Text(
              s.t('Backup', '备份'),
              style: RhythmTheme.mono(12, color: RhythmTheme.accent),
            ),
            const Icon(Icons.expand_more, size: 18, color: RhythmTheme.accent),
          ],
        ],
      ),
    ),
  );
  Widget _sidebar() => Container(
    width: 222,
    decoration: const BoxDecoration(
      color: RhythmTheme.sidebar,
      border: Border(right: BorderSide(color: RhythmTheme.line)),
    ),
    child: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 38, 20, 38),
            child: Row(
              children: [
                const Icon(
                  Icons.monitor_heart_outlined,
                  size: 35,
                  color: RhythmTheme.ink,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          s.t('RHYTHM', '律动'),
                          style: const TextStyle(
                            fontSize: 23,
                            letterSpacing: 3,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          s.t('PERSONAL PRACTICE', '个人日常实践'),
                          style: RhythmTheme.mono(
                            7,
                            color: RhythmTheme.secondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Eyebrow(
              s.t(
                'NAVIGATION                         [ 03 ]',
                '导航                              [ 03 ]',
              ),
            ),
          ),
          const SizedBox(height: 16),
          for (var i = 0; i < 3; i++) _navigationTile(i),
          const Padding(
            padding: EdgeInsets.fromLTRB(24, 28, 24, 26),
            child: Divider(),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Eyebrow(s.t('▪ DAY BY DAY', '▪ 日复一日')),
                  const SizedBox(height: 18),
                  Text(
                    s.t('Consistency,\none day at a time.', '保持节奏，\n每天前进一步。'),
                    style: const TextStyle(fontSize: 17, height: 1.7),
                  ),
                  const SizedBox(height: 24),
                  const SizedBox(
                    height: 78,
                    width: double.infinity,
                    child: CustomPaint(painter: _SidebarWave()),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    s.t('Your actions\nshape your rhythm.', '你的行动，\n塑造你的节奏。'),
                    style: RhythmTheme.mono(10, color: RhythmTheme.secondary),
                  ),
                ],
              ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 24),
            child: Divider(),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _languageMenu(),
                _backupMenu(),
                const SizedBox(height: 8),
                Text(
                  s.t('• Saved to your account', '• 保存到账号'),
                  style: RhythmTheme.mono(8, color: RhythmTheme.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  Widget _navigationTile(int index) {
    final selected = _tab == index;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: Semantics(
        selected: selected,
        child: Material(
          color: selected
              ? RhythmTheme.ink.withValues(alpha: .045)
              : Colors.transparent,
          child: InkWell(
            key: ValueKey('nav-$index'),
            onTap: () => _navigate(index),
            child: Container(
              decoration: BoxDecoration(
                border: Border(
                  left: BorderSide(
                    color: selected ? RhythmTheme.accent : Colors.transparent,
                    width: 2,
                  ),
                ),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 17),
              child: Row(
                children: [
                  Text(
                    '0${index + 1}',
                    style: RhythmTheme.mono(
                      10,
                      color: selected ? RhythmTheme.accent : RhythmTheme.muted,
                    ),
                  ),
                  const SizedBox(width: 13),
                  Expanded(
                    child: Text(
                      _tabs[index],
                      style: TextStyle(
                        fontSize: 13,
                        color: selected
                            ? RhythmTheme.ink
                            : RhythmTheme.secondary,
                      ),
                    ),
                  ),
                  if (index == 2)
                    Text(
                      '${store.activeHabits.length}'.padLeft(2, '0'),
                      style: RhythmTheme.mono(10, color: RhythmTheme.secondary),
                    )
                  else if (selected)
                    const Icon(
                      Icons.north_east,
                      size: 13,
                      color: RhythmTheme.accent,
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 880;
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.digit1, alt: true): () =>
            _navigate(0),
        const SingleActivator(LogicalKeyboardKey.digit2, alt: true): () =>
            _navigate(1),
        const SingleActivator(LogicalKeyboardKey.digit3, alt: true): () =>
            _navigate(2),
        const SingleActivator(LogicalKeyboardKey.keyN, alt: true): () =>
            _edit(),
      },
      child: Focus(
        autofocus: true,
        child: Scaffold(
          body: Row(
            children: [
              if (wide) _sidebar(),
              Expanded(
                child: SafeArea(
                  child: Column(
                    children: [
                      Container(
                        height: wide ? 62 : 58,
                        padding: EdgeInsets.symmetric(
                          horizontal: wide ? 32 : 16,
                        ),
                        decoration: const BoxDecoration(
                          border: Border(
                            bottom: BorderSide(color: RhythmTheme.line),
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                wide
                                    ? '${s.t('PERSONAL JOURNAL', '个人日志')}  /  ${_tabs[_tab].toUpperCase()}'
                                    : s.t('RHYTHM', '律动'),
                                style: RhythmTheme.mono(
                                  wide ? 10 : 16,
                                  color: RhythmTheme.secondary,
                                ),
                              ),
                            ),
                            Semantics(
                              liveRegion: true,
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    store.saveFailed
                                        ? Icons.error_outline
                                        : store.saving
                                        ? Icons.more_horiz
                                        : Icons.circle,
                                    size: store.saving || store.saveFailed
                                        ? 15
                                        : 5,
                                    color: store.saveFailed
                                        ? RhythmTheme.accent
                                        : RhythmTheme.secondary,
                                  ),
                                  const SizedBox(width: 7),
                                  Text(
                                    !store.ready
                                        ? s.t('DATA UNAVAILABLE', '数据不可用')
                                        : store.saveFailed
                                        ? s.t('NOT SAVED', '尚未保存')
                                        : store.saving
                                        ? s.t('SAVING…', '保存中…')
                                        : s.t('SAVED TO ACCOUNT', '已保存到账号'),
                                    style: RhythmTheme.mono(
                                      9,
                                      color: RhythmTheme.secondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (!wide) ...[
                              const SizedBox(width: 8),
                              _languageMenu(compact: true),
                              _backupMenu(compact: true),
                            ],
                          ],
                        ),
                      ),
                      if (store.error != null) _errorBanner(),
                      Expanded(
                        child: store.loading
                            ? const Center(child: CircularProgressIndicator())
                            : !store.ready
                            ? _loadFailure()
                            : Stack(
                                fit: StackFit.expand,
                                children: [
                                  const TechnicalGrid(),
                                  IndexedStack(
                                    index: _tab,
                                    children: [
                                      _page(0, _journal()),
                                      _page(
                                        1,
                                        StatisticsPage(
                                          journal: store.journal,
                                          analytics: store.analytics,
                                          today: store.today,
                                          selectedDay: store.selectedDay,
                                          strings: s,
                                          onSelectDay: _openDay,
                                        ),
                                      ),
                                      _page(2, _management()),
                                    ],
                                  ),
                                ],
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          bottomNavigationBar: wide
              ? null
              : NavigationBar(
                  selectedIndex: _tab,
                  onDestinationSelected: _navigate,
                  animationDuration: Duration.zero,
                  destinations: [
                    NavigationDestination(
                      key: const ValueKey('nav-0'),
                      icon: const Icon(Icons.today_outlined),
                      label: _tabs[0],
                    ),
                    NavigationDestination(
                      key: const ValueKey('nav-1'),
                      icon: const Icon(Icons.grid_on_outlined),
                      label: _tabs[1],
                    ),
                    NavigationDestination(
                      key: const ValueKey('nav-2'),
                      icon: const Icon(Icons.tune),
                      label: _tabs[2],
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  Widget _page(int index, Widget child) => ExcludeFocus(
    excluding: _tab != index,
    child: ExcludeSemantics(
      excluding: _tab != index,
      child: TickerMode(
        enabled: _tab == index,
        child: SingleChildScrollView(
          key: PageStorageKey('page-$index'),
          controller: _scroll[index],
          padding: EdgeInsets.all(
            MediaQuery.sizeOf(context).width < 600 ? 16 : 30,
          ),
          child: Align(
            alignment: Alignment.topLeft,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1440),
              child: child,
            ),
          ),
        ),
      ),
    ),
  );
  Widget _errorBanner() => Material(
    color: RhythmTheme.pale,
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.error_outline, color: RhythmTheme.accent),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  store.saveFailed && !store.hasConflict
                      ? s.t(
                          'Changes are not saved. Keep this tab open. Retry saving or export your draft as JSON.',
                          '更改尚未保存。请保持此标签页开启，重试保存或将草稿导出为 JSON。',
                        )
                      : s.error(store.error!),
                ),
              ),
              if (!store.saveFailed && store.ready)
                IconButton(
                  tooltip: s.t('Dismiss', '关闭'),
                  onPressed: store.dismissError,
                  icon: const Icon(Icons.close),
                ),
            ],
          ),
          if (store.saveFailed)
            Wrap(
              spacing: 8,
              children: [
                TextButton(
                  onPressed: _export,
                  child: Text(s.t('Export draft JSON', '导出草稿 JSON')),
                ),
                if (!store.hasConflict)
                  TextButton(
                    onPressed: store.saving ? null : store.retrySave,
                    child: Text(s.t('Retry', '重试')),
                  ),
                TextButton(
                  onPressed: store.saving ? null : _reloadSaved,
                  child: Text(s.t('Load saved version', '加载已保存版本')),
                ),
              ],
            ),
        ],
      ),
    ),
  );
  Widget _loadFailure() => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 480),
      child: Padding(
        padding: const EdgeInsets.all(30),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.folder_off_outlined,
              size: 40,
              color: RhythmTheme.secondary,
            ),
            const SizedBox(height: 18),
            Text(
              s.t('Your journal could not be opened.', '无法打开你的日记。'),
              style: const TextStyle(fontSize: 22),
            ),
            const SizedBox(height: 12),
            Text(
              s.t(
                'Your stored data has been preserved. Retry, or restore a valid JSON backup.',
                '原始文件已保留。请重试，或从有效的 JSON 备份恢复。',
              ),
            ),
            const SizedBox(height: 22),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                OutlinedButton(
                  onPressed: store.load,
                  child: Text(s.t('Retry', '重试')),
                ),
                FilledButton(
                  onPressed: _import,
                  child: Text(s.t('Restore backup', '恢复备份')),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );

  Widget _journal() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 24,
        runSpacing: 16,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Eyebrow(s.t('01 / DAILY PRACTICE', '01 / 每日实践')),
              const SizedBox(height: 10),
              Text(
                s.t('Observe. Repeat. Continue.', '观察。重复。坚持。'),
                style: const TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w300,
                  letterSpacing: -.8,
                ),
              ),
            ],
          ),
          FilledButton.icon(
            onPressed: _edit,
            icon: const Icon(Icons.add, size: 18),
            label: Text(s.t('New habit', '新建习惯')),
          ),
        ],
      ),
      const SizedBox(height: 24),
      _dayPicker(),
      const SizedBox(height: 22),
      DailyProgressPanel(
        journal: store.journal,
        day: store.selectedDay,
        strings: s,
        includeArchived: store.selectedDay.compareTo(store.today) < 0,
      ),
      const SizedBox(height: 26),
      Row(
        children: [
          Expanded(
            child: Eyebrow(
              s.t(
                'DAILY HABITS  [ ${store.dailyHabits.length.toString().padLeft(2, '0')} ]',
                '每日习惯  [ ${store.dailyHabits.length.toString().padLeft(2, '0')} ]',
              ),
            ),
          ),
          Text(
            store.selectedDay,
            style: RhythmTheme.mono(10, color: RhythmTheme.secondary),
          ),
        ],
      ),
      const SizedBox(height: 14),
      if (store.isFuture)
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Text(
            s.t(
              'Future days are read-only. Come back on this date to record your habits.',
              '未来日期仅供查看。请在当天记录你的习惯。',
            ),
            style: const TextStyle(color: RhythmTheme.secondary),
          ),
        ),
      if (store.dailyHabits.isEmpty)
        Panel(
          child: SizedBox(
            width: double.infinity,
            child: Column(
              children: [
                const SizedBox(height: 16),
                const Icon(
                  Icons.add_chart,
                  size: 36,
                  color: RhythmTheme.secondary,
                ),
                const SizedBox(height: 18),
                Text(
                  s.t('No habits for this day yet.', '这一天还没有习惯。'),
                  style: const TextStyle(fontSize: 20),
                ),
                const SizedBox(height: 10),
                Text(
                  s.t(
                    'Start small. Make a little room for yourself.',
                    '从小事开始，为自己留一点空间。',
                  ),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: RhythmTheme.secondary),
                ),
                const SizedBox(height: 22),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  alignment: WrapAlignment.center,
                  children: [
                    FilledButton(
                      onPressed: _edit,
                      child: Text(s.t('Create a habit', '创建习惯')),
                    ),
                    if (store.journal.habits.isEmpty)
                      OutlinedButton(
                        onPressed: store.addExamples,
                        child: Text(s.t('Add 4 examples', '添加 4 个示例')),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ),
      for (final habit in store.dailyHabits)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: HabitCard(
            key: ValueKey('${habit.id}/${store.selectedDay}'),
            habit: habit,
            entry: store.journal.entry(habit.id, store.selectedDay),
            strings: s,
            enabled: !store.isFuture && !store.importing,
            onChanged: (entry) => unawaited(store.updateEntry(entry)),
            onDurationSessionsChanged: (entry, categories) =>
                unawaited(store.updateDurationSessions(entry, categories)),
            onClear: () => store.clearEntry(habit),
            onEdit: () => _edit(habit),
            onArchive: habit.archivedOn == null && !store.importing
                ? () => unawaited(_archive(habit))
                : null,
            onRestore: habit.archivedOn != null && !store.importing
                ? () => unawaited(_restore(habit))
                : null,
          ),
        ),
      const SizedBox(height: 22),
      ActivityMap(
        analytics: store.analytics,
        habits: store.journal.habits,
        selectedDay: store.selectedDay,
        today: store.today,
        strings: s,
        onSelectDay: _openDay,
      ),
    ],
  );

  Widget _dayPicker() {
    final selected = DayKey.parse(store.selectedDay)!;
    final monday = DayKey.add(store.selectedDay, 1 - selected.weekday);
    return Column(
      children: [
        Row(
          children: [
            IconButton(
              tooltip: s.t('Previous week', '上一周'),
              onPressed: () =>
                  store.selectDay(DayKey.add(store.selectedDay, -7)),
              icon: const Icon(Icons.chevron_left, size: 18),
            ),
            Expanded(
              child: Row(
                children: [
                  for (var i = 0; i < 7; i++)
                    Expanded(child: _dayButton(DayKey.add(monday, i), i + 1)),
                ],
              ),
            ),
            IconButton(
              tooltip: s.t('Next week', '下一周'),
              onPressed: () =>
                  store.selectDay(DayKey.add(store.selectedDay, 7)),
              icon: const Icon(Icons.chevron_right, size: 18),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            TextButton.icon(
              key: const ValueKey('date-picker'),
              onPressed: () async {
                final date = await showDatePicker(
                  context: context,
                  initialDate: DayKey.parse(store.selectedDay),
                  firstDate: DateTime(1),
                  lastDate: DateTime(9999, 12, 31),
                  helpText: s.t('Choose a day', '选择日期'),
                );
                if (date != null) store.selectDay(DayKey.fromDate(date));
              },
              icon: const Icon(Icons.calendar_today_outlined, size: 14),
              label: Text(s.dayLabel(store.selectedDay)),
            ),
            if (store.selectedDay != store.today)
              TextButton(
                onPressed: () => store.selectDay(store.today),
                child: Text(s.t('Today', '今天')),
              ),
          ],
        ),
      ],
    );
  }

  Widget _dayButton(String day, int weekday) {
    final active = day == store.selectedDay;
    return Semantics(
      button: true,
      selected: active,
      label: s.dayLabel(day),
      child: ExcludeSemantics(
        child: InkWell(
          onTap: () => store.selectDay(day),
          borderRadius: BorderRadius.circular(4),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 2),
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              color: active ? RhythmTheme.pale : Colors.transparent,
              borderRadius: BorderRadius.circular(4),
              border: Border.all(
                color: active ? RhythmTheme.accent : Colors.transparent,
              ),
            ),
            child: Column(
              children: [
                Text(
                  s.weekday(weekday),
                  style: RhythmTheme.mono(
                    8,
                    color: active ? RhythmTheme.accent : RhythmTheme.secondary,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '${DayKey.parse(day)!.day}',
                  style: RhythmTheme.mono(
                    16,
                    color: day.compareTo(store.today) > 0
                        ? RhythmTheme.muted
                        : RhythmTheme.ink,
                  ),
                ),
                const SizedBox(height: 5),
                Container(
                  width: 3,
                  height: 3,
                  color: day == store.today
                      ? RhythmTheme.accent
                      : Colors.transparent,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _management() {
    final habits = _showArchive ? store.archivedHabits : store.activeHabits;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Eyebrow(s.t('YOUR PERSONAL PRACTICE', '你的日常实践')),
        const SizedBox(height: 12),
        Text(
          s.t('Build your rhythm.', '建立你的节奏。'),
          style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w300),
        ),
        const SizedBox(height: 10),
        Text(
          s.t(
            'Small actions. A practice that belongs to you.',
            '小小行动，成为属于你的日常。',
          ),
          style: const TextStyle(color: RhythmTheme.secondary),
        ),
        const SizedBox(height: 24),
        Wrap(
          spacing: 20,
          runSpacing: 14,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            FilledButton.icon(
              onPressed: _edit,
              icon: const Icon(Icons.add, size: 18),
              label: Text(s.t('New habit', '新建习惯')),
            ),
          ],
        ),
        const SizedBox(height: 18),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            ChoiceChip(
              key: const ValueKey('active-habits-filter'),
              label: Text(
                s.t(
                  'Active (${store.activeHabits.length})',
                  '活跃（${store.activeHabits.length}）',
                ),
              ),
              selected: !_showArchive,
              onSelected: (_) => setState(() => _showArchive = false),
            ),
            ChoiceChip(
              key: const ValueKey('archived-habits-filter'),
              avatar: const Icon(Icons.archive_outlined, size: 16),
              label: Text(
                s.t(
                  'Archive (${store.archivedHabits.length})',
                  '归档（${store.archivedHabits.length}）',
                ),
              ),
              selected: _showArchive,
              onSelected: (_) => setState(() => _showArchive = true),
            ),
          ],
        ),
        if (_showArchive) ...[
          const SizedBox(height: 14),
          Text(
            s.t(
              'Archived habits stay out of today’s journal. Their history is kept, and you can restore them anytime.',
              '归档习惯不会出现在今天的日记中。历史记录会保留，你可以随时恢复。',
            ),
            style: const TextStyle(color: RhythmTheme.secondary),
          ),
        ],
        const SizedBox(height: 24),
        if (habits.isEmpty)
          Panel(
            child: SizedBox(
              width: double.infinity,
              child: Padding(
                padding: const EdgeInsets.all(22),
                child: Text(
                  _showArchive
                      ? s.t('Your archive is empty.', '归档为空。')
                      : s.t(
                          'No active habits. Create one or restore a habit from the archive.',
                          '暂无活跃习惯。新建习惯或从归档中恢复。',
                        ),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ),
        for (final habit in habits)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Panel(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    RhythmTheme.iconFor(habit.symbol),
                    size: 25,
                    color: RhythmTheme.ink,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(habit.title, style: const TextStyle(fontSize: 16)),
                        const SizedBox(height: 5),
                        Text(
                          habit.archivedOn == null
                              ? s.kind(habit.kind)
                              : s.t('Archived · history kept', '已归档 · 历史记录已保留'),
                          style: RhythmTheme.mono(
                            10,
                            color: RhythmTheme.secondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (habit.archivedOn != null)
                    TextButton(
                      onPressed: store.importing
                          ? null
                          : () => unawaited(_restore(habit)),
                      child: Text(s.t('Restore', '恢复')),
                    ),
                  PopupMenuButton<String>(
                    tooltip: s.t('More', '更多'),
                    onSelected: (action) {
                      if (action == 'edit') {
                        _edit(habit);
                      } else if (action == 'archive') {
                        unawaited(_archive(habit));
                      } else if (action == 'restore') {
                        unawaited(_restore(habit));
                      } else {
                        _delete(habit);
                      }
                    },
                    itemBuilder: (_) => [
                      PopupMenuItem(
                        value: 'edit',
                        child: Text(s.t('Edit habit', '编辑习惯')),
                      ),
                      if (habit.archivedOn == null)
                        PopupMenuItem(
                          value: 'archive',
                          enabled: !store.importing,
                          child: Text(s.t('Archive habit', '归档习惯')),
                        )
                      else
                        PopupMenuItem(
                          value: 'restore',
                          enabled: !store.importing,
                          child: Text(s.t('Restore habit', '恢复习惯')),
                        ),
                      PopupMenuItem(
                        value: 'delete',
                        child: Text(
                          s.t('Delete permanently', '永久删除'),
                          style: const TextStyle(color: RhythmTheme.accent),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _SidebarWave extends CustomPainter {
  const _SidebarWave();
  @override
  void paint(Canvas canvas, Size size) {
    for (var line = 0; line < 14; line++) {
      final path = Path();
      for (var x = 0.0; x <= size.width; x += 2) {
        final distance = (x / size.width - .55).abs();
        final peak = (1 - distance * 3).clamp(0.0, 1.0);
        final y =
            size.height * .7 + line * 1.8 - peak * peak * (45 - line * 1.2);
        if (x == 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = RhythmTheme.secondary.withValues(alpha: .14 + line * .012)
          ..style = PaintingStyle.stroke
          ..strokeWidth = .5,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _SidebarWave oldDelegate) => false;
}
