import 'package:flutter/material.dart';

/// The same graphite, red, and fine-line visual language as the Mac app.
abstract final class RhythmTheme {
  static const canvas = Color(0xFF080A0B);
  static const paper = Color(0xFF0D1012);
  static const ink = Color(0xFFE7EBEB);
  static const secondary = Color(0xFF939B9C);
  static const muted = Color(0xFF778085);
  static const accent = Color(0xFFF34B3F);
  static const line = Color(0xFF293033);
  static const sidebar = Color(0xFF060809);
  static const pale = Color(0xFF181112);
  static const palette = <Color>[
    accent,
    Color(0xFFD8E1E5),
    Color(0xFF6DADB5),
    Color(0xFFC7A778),
    Color(0xFFA796C2),
    Color(0xFF87A493),
  ];

  static TextStyle mono(
    double size, {
    Color? color,
    FontWeight weight = FontWeight.w400,
  }) => TextStyle(
    fontFamily: 'Menlo',
    fontFamilyFallback: const ['Consolas', 'monospace'],
    fontSize: size,
    fontWeight: weight,
    color: color ?? ink,
    height: 1.35,
  );

  static ThemeData get data {
    const border = OutlineInputBorder(
      borderRadius: BorderRadius.all(Radius.circular(4)),
      borderSide: BorderSide(color: line),
    );
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: canvas,
      canvasColor: paper,
      dividerColor: line,
      colorScheme: const ColorScheme.dark(
        primary: accent,
        onPrimary: canvas,
        secondary: ink,
        onSecondary: canvas,
        surface: paper,
        onSurface: ink,
        onSurfaceVariant: secondary,
        outline: line,
        error: Color(0xFFFF8B82),
      ),
    );
    return base.copyWith(
      textTheme: base.textTheme.apply(bodyColor: ink, displayColor: ink),
      appBarTheme: const AppBarTheme(
        backgroundColor: canvas,
        foregroundColor: ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
      ),
      dividerTheme: const DividerThemeData(color: line, thickness: 1, space: 1),
      inputDecorationTheme: InputDecorationTheme(
        border: border,
        enabledBorder: border,
        disabledBorder: border,
        focusedBorder: border.copyWith(
          borderSide: const BorderSide(color: accent),
        ),
        filled: true,
        fillColor: canvas,
        labelStyle: const TextStyle(color: secondary),
        hintStyle: const TextStyle(color: muted),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 14,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: canvas,
          textStyle: mono(12, weight: FontWeight.w600),
          minimumSize: const Size(44, 44),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ink,
          side: const BorderSide(color: line),
          textStyle: mono(12),
          minimumSize: const Size(44, 44),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: ink,
          textStyle: mono(12),
          minimumSize: const Size(44, 44),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(foregroundColor: secondary),
      ),
      checkboxTheme: CheckboxThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(3)),
        side: const BorderSide(color: secondary),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: canvas,
        selectedColor: pale,
        side: const BorderSide(color: line),
        labelStyle: mono(11),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: sidebar,
        surfaceTintColor: Colors.transparent,
        indicatorColor: pale,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => mono(
            10,
            color: states.contains(WidgetState.selected) ? ink : secondary,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected) ? accent : secondary,
            size: 22,
          ),
        ),
      ),
      tooltipTheme: TooltipThemeData(
        textStyle: mono(11),
        decoration: BoxDecoration(
          color: paper,
          border: Border.all(color: line),
          borderRadius: BorderRadius.circular(4),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: paper,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          side: const BorderSide(color: line),
          borderRadius: BorderRadius.circular(4),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: paper,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: line),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: Color(0xFF242B2E),
        contentTextStyle: TextStyle(color: ink),
        behavior: SnackBarBehavior.floating,
      ),
      scrollbarTheme: ScrollbarThemeData(
        thumbColor: WidgetStateProperty.all(line),
        thickness: WidgetStateProperty.all(4),
        radius: const Radius.circular(2),
      ),
    );
  }

  static Color heat(double score) {
    if (score <= 0) return const Color(0xFF171D20);
    if (score < 0.25) return const Color(0xFF76372F);
    if (score < 0.5) return const Color(0xFFA04437);
    if (score < 0.8) return const Color(0xFFC24438);
    return accent;
  }

  static IconData iconFor(String symbol) => switch (symbol) {
    'waveform.path' => Icons.graphic_eq,
    'book.closed' => Icons.menu_book_outlined,
    'figure.mind.and.body' => Icons.self_improvement,
    'sun.max' => Icons.wb_sunny_outlined,
    'drop' => Icons.water_drop_outlined,
    'moon' => Icons.dark_mode_outlined,
    'heart' => Icons.favorite_border,
    'pencil' => Icons.edit_outlined,
    'figure.walk' => Icons.directions_walk,
    'cup.and.saucer' => Icons.local_cafe_outlined,
    'brain.head.profile' => Icons.psychology_outlined,
    'music.note' => Icons.music_note_outlined,
    'checkmark.circle' => Icons.check_circle_outline,
    'clock' => Icons.schedule,
    'number' => Icons.tag,
    'text.alignleft' => Icons.notes,
    'checklist' => Icons.checklist,
    'list.bullet' => Icons.list,
    _ => Icons.radio_button_checked,
  };
}

class Panel extends StatelessWidget {
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: RhythmTheme.paper,
      borderRadius: BorderRadius.circular(4),
      border: Border.all(color: RhythmTheme.line),
    ),
    child: Padding(padding: padding, child: child),
  );
}

class Eyebrow extends StatelessWidget {
  const Eyebrow(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: RhythmTheme.mono(
      10,
      color: RhythmTheme.secondary,
    ).copyWith(letterSpacing: 1.2),
  );
}

/// A subtle, static drafting grid. It never participates in hit testing.
class TechnicalGrid extends StatelessWidget {
  const TechnicalGrid({super.key});

  @override
  Widget build(BuildContext context) => const IgnorePointer(
    child: ExcludeSemantics(
      child: CustomPaint(painter: _TechnicalGridPainter()),
    ),
  );
}

class _TechnicalGridPainter extends CustomPainter {
  const _TechnicalGridPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = RhythmTheme.ink.withValues(alpha: 0.025)
      ..strokeWidth = 0.5;
    for (var x = 0.0; x <= size.width; x += 32) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (var y = 0.0; y <= size.height; y += 32) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _TechnicalGridPainter oldDelegate) => false;
}
