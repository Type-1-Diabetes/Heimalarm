package de.heimalarm.plugin

import androidx.core.content.FileProvider

/** Eigene Klasse, damit sie sich nicht mit einem FileProvider der App überschneidet. */
class UpdateFileProvider : FileProvider()
