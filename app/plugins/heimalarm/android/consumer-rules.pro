# Heimalarm-Plugin: Tauri ruft @Command-Methoden und liest Argument-Klassen (parseArgs) per Reflection.
# Dienste/Empfänger stehen im Manifest. Darum alles im Paket behalten, nichts umbenennen.
-keep class de.heimalarm.plugin.** { *; }
-keepclassmembers class de.heimalarm.plugin.** { *; }
