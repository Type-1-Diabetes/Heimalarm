plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "de.heimalarm.plugin"
    compileSdk = 36
    defaultConfig {
        minSdk = 24
        // Release-APK wird mit R8 verkleinert: Plugin-Klassen bleiben ganz erhalten (Befehle und Argumente per Reflection)
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("androidx.activity:activity-ktx:1.7.2")
    implementation(project(":tauri-android"))
}
