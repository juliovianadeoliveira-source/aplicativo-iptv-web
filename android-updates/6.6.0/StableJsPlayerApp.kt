package com.jsplayer.app.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.jsplayer.app.R
import com.jsplayer.app.api.StableApi
import com.jsplayer.app.device.AccountControl
import com.jsplayer.app.device.DevicePolicy
import com.jsplayer.app.model.StableCatalogItem
import com.jsplayer.app.model.StableCatalogPage
import com.jsplayer.app.model.StableCategory
import com.jsplayer.app.model.StableEpisode
import com.jsplayer.app.model.StableDetail
import com.jsplayer.app.player.NativePlayer
import com.jsplayer.app.settings.StableSettings
import com.jsplayer.app.update.AppUpdater
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import android.util.Base64
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.type
import androidx.compose.ui.composed
import androidx.compose.foundation.layout.heightIn

private val StableBg = Color(0xFF05070D)
private val StablePanel = Color(0xFF0C1018)
private val StablePanel2 = Color(0xFF171C25)
private val StableAccent = Color(0xFFD7FF00)
private val StableOrange = Color(0xFFFFA000)
private val StableMuted = Color(0xFF9AA4B3)
private val StableBrown = Color(0xFF4A1008)




// === JS PLAYER 6.5.0 FOCO TV START ===
private fun Modifier.jsPlayerTvFocus(): Modifier =
    composed {
        var jsPlayerFocused by remember {
            mutableStateOf(false)
        }

        this
            .onFocusChanged {
                jsPlayerFocused =
                    it.isFocused
            }
            .border(
                width =
                    if (jsPlayerFocused)
                        3.dp
                    else
                        0.dp,
                color =
                    if (jsPlayerFocused)
                        StableAccent
                    else
                        Color.Transparent,
                shape =
                    RoundedCornerShape(
                        10.dp
                    )
            )
            .background(
                color =
                    if (jsPlayerFocused)
                        StableAccent.copy(
                            alpha = .12f
                        )
                    else
                        Color.Transparent,
                shape =
                    RoundedCornerShape(
                        10.dp
                    )
            )
    }
// === JS PLAYER 6.5.0 FOCO TV END ===


// === JS PLAYER 6.5.1 OK HOME START ===
private fun Modifier.jsPlayerRemoteOk(
    action: () -> Unit
): Modifier =
    this.onPreviewKeyEvent { event ->
        if (
            event.type == KeyEventType.KeyUp &&
            (
                event.key == Key.DirectionCenter ||
                event.key == Key.Enter ||
                event.key == Key.NumPadEnter
            )
        ) {
            action()
            true
        } else {
            false
        }
    }
// === JS PLAYER 6.5.1 OK HOME END ===

enum class StableSection { HOME, LIVE, MOVIES, SERIES, SPORTS, SETTINGS, PROFILE }

@Composable
fun StableJsPlayerApp() {
    val context = LocalContext.current

    // === JS PLAYER 6.1.1 PREFS START ===
    val jsMainPrefs = remember(context) {
        context.getSharedPreferences(
            "js_player_last_channel",
            android.content.Context.MODE_PRIVATE
        )
    }
    // === JS PLAYER 6.1.1 PREFS END ===
    val scope = rememberCoroutineScope()
    val nativePlayer = remember { NativePlayer(context) }

    // Receptor real: após autenticar, a TV ao vivo é a tela inicial.
    var section by remember { mutableStateOf(StableSection.LIVE) }
    var currentTitle by remember { mutableStateOf("") }
    var currentType by remember { mutableStateOf("") }
    var fullscreen by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var refreshKey by remember { mutableIntStateOf(0) }
    var settingsRevision by remember { mutableIntStateOf(0) }
    var pendingMovie by remember { mutableStateOf<StableCatalogItem?>(null) }
    var pendingSeries by remember { mutableStateOf<StableCatalogItem?>(null) }
    var searchPanelOpen by remember { mutableStateOf(false) }
    var playbackJob by remember { mutableStateOf<Job?>(null) }

    fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()

    fun stopPlayback() {
        playbackJob?.cancel()
        playbackJob = null
        if (currentType.isNotBlank()) {
            scope.launch { StableApi.stopLiveHls() }
        }
        nativePlayer.stop()
        currentTitle = ""
        currentType = ""
        fullscreen = false
    }

    fun navigate(target: StableSection) {
        // === JS PLAYER REMOTE POLICY START ===
        if (
            (target == StableSection.LIVE || target == StableSection.SPORTS) &&
            !DevicePolicy.liveEnabled
        ) {
            toast("TV desativada para este aparelho.")
            return
        }

        if (
            target == StableSection.MOVIES &&
            !DevicePolicy.moviesEnabled
        ) {
            toast("Filmes desativados para este aparelho.")
            return
        }

        if (
            target == StableSection.SERIES &&
            !DevicePolicy.seriesEnabled
        ) {
            toast("Séries desativadas para este aparelho.")
            return
        }
        // === JS PLAYER REMOTE POLICY END ===


        // === JS PLAYER 6.1.1 AUTO FULLSCREEN START ===

        searchQuery = ""
        searchPanelOpen = false

        if (target == StableSection.LIVE) {

            val lastId =
                jsMainPrefs.getString(
                    "last_live_id",
                    ""
                ) ?: ""

            val lastName =
                jsMainPrefs.getString(
                    "last_live_name",
                    ""
                ) ?: ""

            section = StableSection.LIVE

            if (lastId.isNotBlank()) {

                if (
                    currentType == "live" &&
                    currentTitle.isNotBlank()
                ) {
                    fullscreen = true
                    return
                }

                playbackJob?.cancel()
                playbackJob = null

                nativePlayer.stop()

                currentType = "live"
                currentTitle =
                    lastName.ifBlank {
                        "TV AO VIVO"
                    }

                fullscreen = true

                playbackJob = scope.launch {

                    try {

                        runCatching {
                            StableApi.stopLiveHls()
                        }

                        val url =
                            StableApi.startLiveHls(
                                lastId
                            )

                        // Autoabertura do último canal usa o player nativo.
                        // Não chama openExternal aqui porque essa função local
                        // é declarada depois de navigate() na base atual.
                        nativePlayer.play(url)

                    } catch (_: CancellationException) {

                    } catch (e: Exception) {

                        currentType = ""
                        currentTitle = ""
                        fullscreen = false

                        toast(
                            "Canal salvo indisponível. Escolha outro canal."
                        )
                    }
                }

                return
            }

            fullscreen = false
            return
        }

        if (target != section) {
            stopPlayback()
        }

        section = target

        // === JS PLAYER 6.1.1 AUTO FULLSCREEN END ===
    }

    fun openExternal(url: String): Boolean {
        if (!StableSettings.bool(context, StableSettings.EXTERNAL_PLAYER)) return false
        return try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(Uri.parse(url), "video/*")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
            true
        } catch (_: Exception) {
            toast("Nenhum leitor externo disponível")
            false
        }
    }

    fun playItem(item: StableCatalogItem) {
        playbackJob?.cancel()
        playbackJob = scope.launch {
            try {
                when (item.type) {
                    "live" -> {

                        if (currentType.isNotBlank()) StableApi.stopLiveHls()
                        val url = StableApi.streamUrl(
                            "live",
                            item.id,
                            item.ext.ifBlank { "ts" }
                        )
                        currentType = "live"
                        currentTitle = item.name
                        StableSettings.addRecent(context, "live", item.id)
                        if (!openExternal(url)) nativePlayer.play(url)
                    }
                    "movie" -> {
                        if (currentType.isNotBlank()) StableApi.stopLiveHls()
                        nativePlayer.stop()
                        StableApi.ensureSession()
                        val url = StableApi.streamUrl("movie", item.id, item.ext)
                        currentType = "movie"
                        currentTitle = item.name
                        StableSettings.addRecent(context, "movie", item.id)
                        if (!openExternal(url)) nativePlayer.play(url)
                    }
                }
            } catch (_: CancellationException) {
                // Troca rápida de canal: cancelamento normal, sem aviso de erro.
            } catch (e: Exception) {
                toast("Não foi possível abrir: ${e.message ?: "erro"}")
            }
        }
    }

    fun playEpisode(episode: StableEpisode, seriesName: String) {
        playbackJob?.cancel()
        playbackJob = scope.launch {
            try {
                if (currentType.isNotBlank()) StableApi.stopLiveHls()
                nativePlayer.stop()
                StableApi.ensureSession()
                val url = StableApi.streamUrl("series", episode.id, episode.ext)
                currentType = "series"
                currentTitle = "$seriesName • ${episode.title}"
                StableSettings.addRecent(context, "series", episode.id)
                if (!openExternal(url)) nativePlayer.play(url)
            } catch (e: Exception) {
                toast("Não foi possível abrir o episódio: ${e.message ?: "erro"}")
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            playbackJob?.cancel()
            nativePlayer.release()
        }
    }

    LaunchedEffect(Unit) {
        runCatching {
            StableApi.ensureSession()
            StableApi.warmReceiverCache()
            navigate(StableSection.LIVE)
        }
    }

    LaunchedEffect(settingsRevision) {
        if (!StableSettings.bool(context, StableSettings.AUTO_REFRESH, true)) return@LaunchedEffect
        while (isActive) {
            delay(60 * 60 * 1000L)
            refreshKey++
        }
    }

    // VOLTAR abre o menu principal; OK/CENTRO continua responsável pela lista.
    BackHandler(enabled = fullscreen) {
        fullscreen = false
        navigate(StableSection.HOME)
    }
    BackHandler(enabled = !fullscreen && section != StableSection.HOME) { navigate(StableSection.HOME) }

    MaterialTheme {
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .onPreviewKeyEvent { event ->
                    if (
                        event.type == KeyEventType.KeyUp &&
                        event.key == Key.Menu
                    ) {
                        fullscreen = false
                        navigate(StableSection.HOME)
                        true
                    } else {
                        false
                    }
                },
            color = StableBg
        ) {
            if (fullscreen) {

        // === JS PLAYER FULLSCREEN OK RETURN START ===
        val jsFullscreenFocusRequester = remember {
            FocusRequester()
        }

        LaunchedEffect(Unit) {
            jsFullscreenFocusRequester.requestFocus()
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .focusRequester(
                    jsFullscreenFocusRequester
                )
                .onPreviewKeyEvent { event ->
                    if (
                        event.type == KeyEventType.KeyUp &&
                        (
                            event.key == Key.DirectionCenter ||
                            event.key == Key.Enter ||
                            event.key == Key.NumPadEnter
                        )
                    ) {
                        fullscreen = false
                        true
                    } else {
                        false
                    }
                }
                .jsPlayerTvFocus().focusable()
        ) {
                    StablePlayerView(
                        nativePlayer = nativePlayer,
                        modifier = Modifier.fillMaxSize(),
                        isFullscreen = true,
                        onFullscreenChange = { fullscreen = it }
                    )
        }
        // === JS PLAYER FULLSCREEN OK RETURN END ===
                return@Surface
}

            if (section == StableSection.HOME) {
                StableHomeScreen(
                    refreshKey = refreshKey,
                    onOpen = { navigate(it) },
                    onRefresh = {
                        scope.launch {
                            try {
                                StableApi.refreshAll()
                                refreshKey++
                                toast("Lista recarregada")
                            } catch (e: Exception) {
                                toast("Falha ao atualizar: ${e.message ?: "erro"}")
                            }
                        }
                    },
                    onSettings = { navigate(StableSection.SETTINGS) },
                    onProfile = { navigate(StableSection.PROFILE) },
                    onExit = {
                        (context as? Activity)?.let { activity ->
                            activity.finishAndRemoveTask()
                        }
                    }
                )
                return@Surface
            }

            if (section == StableSection.PROFILE) {
                StableProfileScreen(
                    onBack = { navigate(StableSection.HOME) },
                    onRefresh = {
                        scope.launch {
                            try {
                                StableApi.refreshAll()
                                refreshKey++
                                toast("Lista recarregada")
                            } catch (e: Exception) {
                                toast("Falha ao recarregar: ${e.message ?: "erro"}")
                            }
                        }
                    },
                    onCheckUpdate = { AppUpdater.check(context, true) }
                )
                
                // === JS PLAYER PROFILE SWITCH USER START ===
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(28.dp),
                    contentAlignment = Alignment.BottomCenter
                ) {
                    Button(
                        onClick = {
                            AccountControl.switchUser()
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = StableAccent,
                            contentColor = Color.Black
                        )
                    ) {
                        Text(
                            text = "TROCAR USUÁRIO",
                            fontWeight = FontWeight.Black
                        )
                    }
                }
                // === JS PLAYER PROFILE SWITCH USER END ===

return@Surface
            }

            if (section == StableSection.SETTINGS) {
                StableSettingsScreen(
                    revision = settingsRevision,
                    onBack = { navigate(StableSection.HOME) },
                    onChanged = { settingsRevision++ },
                    onReconnect = {
                        scope.launch {
                            try {
                                stopPlayback()
                                StableApi.refreshConnection()
                                refreshKey++
                                toast("Lista reconectada")
                            } catch (e: Exception) {
                                toast("Falha ao reconectar: ${e.message ?: "erro"}")
                            }
                        }
                    },
                    onRefreshCatalogs = {
                        scope.launch {
                            try {
                                StableApi.refreshAll()
                                refreshKey++
                                toast("Catálogos atualizados")
                            } catch (e: Exception) {
                                toast("Falha ao atualizar")
                            }
                        }
                    }
                )
                return@Surface
            }

            Column(Modifier.fillMaxSize().background(StableBg)) {
                // Na TV ao vivo a imagem ocupa a tela inteira, como um receptor.
                // MENU/VOLTAR levam aos quatro cards da tela principal.
                if (section != StableSection.LIVE && section != StableSection.SPORTS) {
                    StableTopNav(
                        current = section,
                        query = searchQuery,
                        onQuery = {
                            searchQuery = it
                            if (it.isNotBlank()) searchPanelOpen = true
                        },
                        onNavigate = { navigate(it) }
                    )
                }

                fun openSearchResult(item: StableCatalogItem) {
                    searchQuery = ""
                    searchPanelOpen = false
                    when (item.type) {
                        "live" -> {
                            section = StableSection.LIVE
                            playItem(item)
                        }
                        "movie" -> {
                            stopPlayback()
                            section = StableSection.MOVIES
                            pendingMovie = item
                        }
                        "series" -> {
                            stopPlayback()
                            section = StableSection.SERIES
                            pendingSeries = item
                        }
                    }
                }

                if (searchPanelOpen || searchQuery.trim().length >= 2) {
                    StableSearchPage(
                        query = searchQuery,
                        onQuery = { searchQuery = it },
                        onBack = {
                            searchQuery = ""
                            searchPanelOpen = false
                        },
                        onClick = { openSearchResult(it) }
                    )
                } else {
                    when (section) {
                        StableSection.LIVE, StableSection.SPORTS -> {
                            Box(
                                Modifier
                                    .fillMaxSize()
                                    .padding(start = 12.dp, end = 12.dp, bottom = 12.dp)
                                    .clip(RoundedCornerShape(7.dp))
                                    .background(Color.Black)
                            ) {
                                StablePlayerView(
                                    nativePlayer = nativePlayer,
                                    modifier = Modifier.fillMaxSize(),
                                    isFullscreen = false,
                                    onFullscreenChange = { fullscreen = it }
                                )

                                StableLiveScreen(
                                    refreshKey = refreshKey,
                                    sportsOnly = section == StableSection.SPORTS,
                                    settingsRevision = settingsRevision,
                                    onPlay = { item ->
                                        if (
                                            currentType != "live" ||
                                            currentTitle != item.name
                                        ) {
                                            playItem(item)
                                        }
                                    },
                                    onDoublePlay = { item ->
                                        if (
                                            currentType != "live" ||
                                            currentTitle != item.name
                                        ) {
                                            playItem(item)
                                        }
                                        fullscreen = true
                                    },
                                    onPreview = { item ->
                                    if (
                                        currentType != "live" ||
                                        currentTitle != item.name
                                    ) {
                                        playItem(item)
                                    }
                                }
                                )
                            }
                        }

                        StableSection.MOVIES -> StableMovieScreen(
                            refreshKey = refreshKey,
                            settingsRevision = settingsRevision,
                            pending = pendingMovie,
                            onPendingConsumed = { pendingMovie = null },
                            onBack = { navigate(StableSection.HOME) },
                            onSearch = { searchPanelOpen = true },
                            onPlay = {
                                playItem(it)
                                fullscreen = true
                            }
                        )

                        StableSection.SERIES -> StableSeriesScreen(
                            refreshKey = refreshKey,
                            settingsRevision = settingsRevision,
                            pending = pendingSeries,
                            onPendingConsumed = { pendingSeries = null },
                            onBack = { navigate(StableSection.HOME) },
                            onSearch = { searchPanelOpen = true },
                            onEpisode = { episode, name ->
                                playEpisode(episode, name)
                                fullscreen = true
                            }
                        )

                        else -> Unit
                    }
                }
            }
        }
    }
}

@Composable
private fun StableTopNav(
    current: StableSection,
    query: String,
    onQuery: (String) -> Unit,
    onNavigate: (StableSection) -> Unit
) {
    val context = LocalContext.current
    val en = StableSettings.language(context) == "en"
    Row(
        Modifier.fillMaxWidth().height(76.dp).background(Color(0xFF06080D)).padding(horizontal = 24.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        StableNav(if (en) "HOME" else "INÍCIO", current == StableSection.HOME) { onNavigate(StableSection.HOME) }
        StableNav(if (en) "LIVE TV" else "TV AO VIVO", current == StableSection.LIVE || current == StableSection.SPORTS) { onNavigate(StableSection.LIVE) }
        StableNav(if (en) "MOVIES" else "FILMES", current == StableSection.MOVIES) { onNavigate(StableSection.MOVIES) }
        StableNav(if (en) "SERIES" else "SÉRIES", current == StableSection.SERIES) { onNavigate(StableSection.SERIES) }
        Spacer(Modifier.width(10.dp))
        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            singleLine = true,
            placeholder = { Text(if (en) "🔍  Search channels, movies and series..." else "🔍  Pesquisar canais, filmes e séries...", color = StableMuted) },
            modifier = Modifier.weight(1f).height(54.dp),
            shape = RoundedCornerShape(28.dp)
        )
    }
}

@Composable
private fun StableNav(label: String, selected: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.height(64.dp).clickable(onClick = onClick).padding(horizontal = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(label, color = if (selected) StableAccent else Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        Spacer(Modifier.height(10.dp))
        Box(Modifier.height(3.dp).width(70.dp).background(if (selected) StableAccent else Color.Transparent))
    }
}

@Composable
private fun StablePlayerView(
    nativePlayer: NativePlayer,
    modifier: Modifier,
    isFullscreen: Boolean = false,
    onFullscreenChange: (Boolean) -> Unit = {}
) {
    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                player = nativePlayer.player
                useController = true
                controllerAutoShow = false
                controllerHideOnTouch = true
                setControllerShowTimeoutMs(2600)
                setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                setKeepContentOnPlayerReset(true)
                setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                keepScreenOn = true
                setFullscreenButtonClickListener { full ->
                    onFullscreenChange(full)
                }
            }
        },
        update = { view ->
            view.player = nativePlayer.player
            view.useController = true
            view.controllerAutoShow = false
            view.controllerHideOnTouch = true
            view.setFullscreenButtonClickListener { full ->
                onFullscreenChange(full)
            }
        },
        modifier = modifier.background(Color.Black)
    )
}

@Composable
private fun StableHomeScreen(
    refreshKey: Int,
    onOpen: (StableSection) -> Unit,
    onRefresh: () -> Unit,
    onSettings: () -> Unit,
    onProfile: () -> Unit,
    onExit: () -> Unit
) {
    val context = LocalContext.current

    // TV Boxes normalmente não têm touchscreen e/ou anunciam LEANBACK.
    // O modo compacto é aplicado SOMENTE nelas.
    val isTvBox = remember {
        val pm = context.packageManager
        pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
            !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)
    }

    var highlights by remember { mutableStateOf<List<StableCatalogItem>>(emptyList()) }
    var heroIndex by remember { mutableIntStateOf(0) }

    LaunchedEffect(refreshKey) {
        runCatching {
            coroutineScope {
                val movieJob = async {
                    StableApi.items("movie", limit = 12).items
                }
                val seriesJob = async {
                    StableApi.items("series", limit = 12).items
                }
                highlights = (movieJob.await() + seriesJob.await())
                    .filter { it.image.isNotBlank() }
                    .take(20)
            }
        }
    }

    LaunchedEffect(highlights) {
        if (highlights.isEmpty()) return@LaunchedEffect
        while (isActive) {
            delay(4500)
            heroIndex = (heroIndex + 1) % highlights.size
        }
    }

    val outerPadding = if (isTvBox) 12.dp else 22.dp
    val topHeight = if (isTvBox) 48.dp else 64.dp
    val logoWidth = if (isTvBox) 112.dp else 150.dp
    val logoHeight = if (isTvBox) 42.dp else 58.dp
    val mainGap = if (isTvBox) 10.dp else 18.dp
    val cardGap = if (isTvBox) 8.dp else 14.dp
    val bodyFraction = if (isTvBox) 0.82f else 1f

    Column(
        Modifier
            .fillMaxSize()
            .background(StableBg)
            .padding(horizontal = 38.dp, vertical = 16.dp)
            .padding(horizontal = 38.dp, vertical = 16.dp)
            .padding(outerPadding)
    ) {
        Row(
            Modifier.fillMaxWidth().height(topHeight),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Image(
                painter = painterResource(R.drawable.js_player_logo),
                contentDescription = "JS PLAYER",
                contentScale = ContentScale.Fit,
                modifier = Modifier.width(logoWidth).height(logoHeight)
            )

            Spacer(Modifier.weight(1f))

            StableHomeIcon("↻", onRefresh, compact = isTvBox)
            StableHomeIcon("⚙", onSettings, compact = isTvBox)
            StableHomeIcon("👤", onProfile, compact = isTvBox)
            StableHomeIcon("↪", onExit, compact = isTvBox)
        }

        Spacer(Modifier.height(if (isTvBox) 6.dp else 10.dp))

        Box(
            Modifier.fillMaxWidth().weight(1f),
            contentAlignment = Alignment.TopCenter
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(bodyFraction),
                horizontalArrangement = Arrangement.spacedBy(mainGap)
            ) {
                Column(
                    Modifier.weight(.42f),
                    verticalArrangement = Arrangement.spacedBy(cardGap)
                ) {
                    Row(
                        Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(cardGap)
                    ) {
                        StableHomeCard(
                            "CANAIS",
                            R.drawable.home_channels,
                            Modifier.weight(1f),
                            compact = isTvBox
                        ) { onOpen(StableSection.LIVE) }

                        StableHomeCard(
                            "FILMES",
                            R.drawable.home_movies,
                            Modifier.weight(1f),
                            compact = isTvBox
                        ) { onOpen(StableSection.MOVIES) }
                    }

                    Row(
                        Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(cardGap)
                    ) {
                        StableHomeCard(
                            "SÉRIES",
                            R.drawable.home_series,
                            Modifier.weight(1f),
                            compact = isTvBox
                        ) { onOpen(StableSection.SERIES) }

                        StableHomeCard(
                            "ESPORTE",
                            R.drawable.home_sports,
                            Modifier.weight(1f),
                            compact = isTvBox
                        ) { onOpen(StableSection.SPORTS) }
                    }
                }

                Box(
                    Modifier
                        .weight(.58f)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(if (isTvBox) 10.dp else 14.dp))
                        .background(StablePanel)
                ) {
                    val hero = highlights.getOrNull(heroIndex)

                    if (hero != null) {
                        AsyncImage(
                            model = hero.image,
                            contentDescription = hero.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxWidth()
                    
                        )

                        Box(
                            Modifier.fillMaxWidth()
                    .heightIn(max = 460.dp).background(
                                Brush.horizontalGradient(
                                    listOf(
                                        Color.Black.copy(alpha = .92f),
                                        Color.Black.copy(alpha = .30f)
                                    )
                                )
                            )
                        )

                        Column(
                            Modifier
                                .align(Alignment.CenterStart)
                                .padding(if (isTvBox) 18.dp else 30.dp)
                                .width(if (isTvBox) 260.dp else 330.dp)
                        ) {
                            Text(
                                if (hero.type == "movie") "FILME" else "SÉRIE",
                                color = Color(0xFF13B8FF),
                                fontWeight = FontWeight.Bold,
                                fontSize = if (isTvBox) 9.sp else 11.sp
                            )

                            Spacer(Modifier.height(if (isTvBox) 5.dp else 8.dp))

                            Text(
                                hero.name,
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = if (isTvBox) 21.sp else 30.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )

                            if (hero.plot.isNotBlank()) {
                                Spacer(Modifier.height(if (isTvBox) 5.dp else 8.dp))
                                Text(
                                    hero.plot,
                                    color = Color.White.copy(alpha = .85f),
                                    maxLines = if (isTvBox) 2 else 3,
                                    overflow = TextOverflow.Ellipsis,
                                    fontSize = if (isTvBox) 10.sp else 13.sp
                                )
                            }
                        }

                        Row(
                            Modifier
                                .align(Alignment.BottomCenter)
                                .padding(if (isTvBox) 8.dp else 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(5.dp)
                        ) {
                            highlights.take(12).forEachIndexed { index, _ ->
                                Box(
                                    Modifier
                                        .width(
                                            if (index == heroIndex) {
                                                if (isTvBox) 14.dp else 20.dp
                                            } else {
                                                if (isTvBox) 5.dp else 6.dp
                                            }
                                        )
                                        .height(if (isTvBox) 5.dp else 6.dp)
                                        .clip(RoundedCornerShape(50))
                                        .background(
                                            if (index == heroIndex) {
                                                Color(0xFF16B8F3)
                                            } else {
                                                Color.Gray
                                            }
                                        )
                                )
                            }
                        }
                    } else {
                        CircularProgressIndicator(
                            Modifier.align(Alignment.Center),
                            color = StableAccent
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StableHomeIcon(
    symbol: String,
    onClick: () -> Unit,
    compact: Boolean = false
) {
    val iconSize = if (compact) 32.dp else 44.dp
    val radius = if (compact) 9.dp else 12.dp
    val horizontalPadding = if (compact) 3.dp else 5.dp

    Box(
        Modifier
            .padding(horizontal = horizontalPadding)
            .size(iconSize)
            .clip(RoundedCornerShape(radius))
            .border(
                1.dp,
                Color.White.copy(alpha = .65f),
                RoundedCornerShape(radius)
            )
            .background(StablePanel2)
            .jsPlayerTvFocus()
            .jsPlayerTvFocus().focusable()
            .jsPlayerRemoteOk(onClick)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            symbol,
            color = Color.White,
            fontSize = if (compact) 15.sp else 20.sp
        )
    }
}

@Composable
private fun StableHomeCard(
    title: String,
    imageRes: Int,
    modifier: Modifier,
    compact: Boolean = false,
    onClick: () -> Unit
) {
    val radius = if (compact) 10.dp else 14.dp
    val footerHeight = if (compact) 40.dp else 58.dp

    Column(
        modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(radius))
            .border(
                if (compact) 1.dp else 2.dp,
                Color(0xFF10B8FF),
                RoundedCornerShape(radius)
            )
            .background(StablePanel2)
            .jsPlayerTvFocus()
            .jsPlayerTvFocus().focusable()
            .jsPlayerRemoteOk(onClick)
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(StablePanel2),
            contentAlignment = Alignment.Center
        ) {
            Image(
                painter = painterResource(imageRes),
                contentDescription = title,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(if (compact) 7.dp else 10.dp),
                contentScale = ContentScale.Fit
            )
        }

        Box(
            Modifier
                .fillMaxWidth()
                .height(footerHeight)
                .background(Color(0xFFF6F6F6)),
            contentAlignment = Alignment.Center
        ) {
            Text(
                title,
                color = Color(0xFF0878BC),
                fontWeight = FontWeight.Bold,
                fontSize = if (compact) 16.sp else 22.sp
            )
        }
    }
}

private fun isAdultCategory(name: String): Boolean {
    val n = name.lowercase()
    return listOf("adult", "xxx", "18+", "erotic", "erótico", "sexo").any { n.contains(it) }
}


// === JS PLAYER TV EPG HELPERS START ===
private data class StableEpgProgram(
    val title: String,
    val description: String,
    val startTimestamp: Long,
    val stopTimestamp: Long,
    val startLabel: String,
    val stopLabel: String
)

private data class StableEpgState(
    val current: StableEpgProgram?,
    val next: StableEpgProgram?,
    val progress: Float
)

private fun stableDecodeEpgText(value: String): String {
    val raw = value.trim()
    if (raw.isBlank()) return ""

    val decoded = runCatching {
        String(Base64.decode(raw, Base64.DEFAULT), Charsets.UTF_8).trim()
    }.getOrNull()

    if (decoded.isNullOrBlank()) return raw

    val printable = decoded.count { ch ->
        ch == '\n' || ch == '\r' || ch == '\t' ||
            ch.code in 32..126 || ch.code >= 160
    }

    return if (printable >= (decoded.length * 0.80f).toInt()) decoded else raw
}

private fun stableEpgTimestamp(o: JSONObject, start: Boolean): Long {
    val keys = if (start) {
        listOf("start_timestamp", "start_timestamp_utc")
    } else {
        listOf("stop_timestamp", "end_timestamp", "stop_timestamp_utc")
    }

    for (key in keys) {
        val value = o.optLong(key, 0L)
        if (value > 0L) return value
    }

    return 0L
}

private fun stableEpgLabel(
    o: JSONObject,
    timestamp: Long,
    start: Boolean
): String {
    if (timestamp > 0L) {
        return runCatching {
            SimpleDateFormat("HH:mm", Locale.getDefault())
                .format(Date(timestamp * 1000L))
        }.getOrDefault("")
    }

    val keys = if (start) {
        listOf("start", "start_time")
    } else {
        listOf("end", "stop", "end_time")
    }

    for (key in keys) {
        val raw = o.optString(key).trim()
        if (raw.isBlank()) continue
        val m = Regex("(?:\\d{4}-\\d{2}-\\d{2}[ T])?(\\d{2}:\\d{2})").find(raw)
        return m?.groupValues?.getOrNull(1) ?: raw.takeLast(5)
    }

    return ""
}

private fun stableParseEpg(root: JSONObject): StableEpgState {
    val arr =
        root.optJSONArray("epg_listings")
            ?: root.optJSONArray("listings")
            ?: root.optJSONArray("epg")
            ?: JSONArray()

    val programs = mutableListOf<StableEpgProgram>()

    for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val startTs = stableEpgTimestamp(o, true)
        val stopTs = stableEpgTimestamp(o, false)

        programs += StableEpgProgram(
            title = stableDecodeEpgText(
                o.optString("title", o.optString("name"))
            ).ifBlank { "Programação" },
            description = stableDecodeEpgText(
                o.optString("description", o.optString("desc"))
            ),
            startTimestamp = startTs,
            stopTimestamp = stopTs,
            startLabel = stableEpgLabel(o, startTs, true),
            stopLabel = stableEpgLabel(o, stopTs, false)
        )
    }

    if (programs.isEmpty()) {
        return StableEpgState(null, null, 0f)
    }

    val now = System.currentTimeMillis() / 1000L

    var currentIndex = programs.indexOfFirst {
        it.startTimestamp > 0L &&
            it.stopTimestamp > 0L &&
            now in it.startTimestamp until it.stopTimestamp
    }

    if (currentIndex < 0) currentIndex = 0

    val current = programs.getOrNull(currentIndex)
    val next = programs.getOrNull(currentIndex + 1)

    val progress =
        if (
            current != null &&
            current.startTimestamp > 0L &&
            current.stopTimestamp > current.startTimestamp
        ) {
            (
                (now - current.startTimestamp).toFloat() /
                    (current.stopTimestamp - current.startTimestamp).toFloat()
            ).coerceIn(0f, 1f)
        } else {
            0f
        }

    return StableEpgState(current, next, progress)
}
// === JS PLAYER TV EPG HELPERS END ===



// === JS PLAYER 5.8.1 CATEGORY VISUAL START ===
@Composable
private fun StableLiveCategoryRow(
    name: String,
    active: Boolean,
    onSelect: () -> Unit
) {
    var focused by remember(name) {
        mutableStateOf(false)
    }

    val shape =
        RoundedCornerShape(8.dp)

    Row(
        Modifier
            .fillMaxWidth()
            .padding(
                horizontal = 3.dp,
                vertical = 2.dp
            )
            .height(43.dp)
            .clip(shape)
            .background(
                when {
                    focused ->
                        StableAccent.copy(
                            alpha = .20f
                        )
                    active ->
                        Color.White.copy(
                            alpha = .12f
                        )
                    else ->
                        Color.Black.copy(
                            alpha = .16f
                        )
                }
            )
            .border(
                if (focused)
                    3.dp
                else if (active)
                    1.dp
                else
                    0.dp,
                if (
                    focused ||
                    active
                )
                    StableAccent
                else
                    Color.Transparent,
                shape
            )
            .onFocusChanged { state ->
                focused =
                    state.isFocused
            }
            .onPreviewKeyEvent { event ->
                if (
                    event.type ==
                    KeyEventType.KeyUp &&
                    (
                        event.key ==
                        Key.DirectionCenter ||
                        event.key ==
                        Key.Enter ||
                        event.key ==
                        Key.NumPadEnter
                    )
                ) {
                    onSelect()
                    true
                } else {
                    false
                }
            }
            .clickable(
                onClick = onSelect
            )
            .jsPlayerTvFocus().focusable()
            .padding(
                horizontal = 8.dp
            ),
        verticalAlignment =
            Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(6.dp)
                .height(29.dp)
                .clip(
                    RoundedCornerShape(
                        4.dp
                    )
                )
                .background(
                    if (
                        focused ||
                        active
                    )
                        StableAccent
                    else
                        Color.Transparent
                )
        )

        Spacer(
            Modifier.width(8.dp)
        )

        Text(
            name,
            color =
                if (
                    focused ||
                    active
                )
                    StableAccent
                else
                    Color.White,
            fontWeight =
                if (
                    focused ||
                    active
                )
                    FontWeight.Bold
                else
                    FontWeight.Normal,
            fontSize = 11.sp,
            maxLines = 1,
            overflow =
                TextOverflow.Ellipsis,
            modifier =
                Modifier.weight(1f)
        )
    }
}

// === JS PLAYER 5.8.1 CATEGORY VISUAL END ===

@Composable
private fun StableLiveScreen(
    refreshKey: Int,
    sportsOnly: Boolean,
    settingsRevision: Int,
    onPlay: (StableCatalogItem) -> Unit,
    onDoublePlay: (StableCatalogItem) -> Unit,
    onPreview: (StableCatalogItem) -> Unit
) {
    val context = LocalContext.current

    // === JS PLAYER TV MEMORY START ===
    val jsLastPrefs = remember(context) {
        context.getSharedPreferences(
            "js_player_last_channel",
            android.content.Context.MODE_PRIVATE
        )
    }

    val jsLastCategoryKey =
        if (sportsOnly)
            "last_sports_category_id"
        else
            "last_live_category_id"

    val jsLastChannelKey =
        if (sportsOnly)
            "last_sports_channel_id"
        else
            "last_live_id"

    var jsLastRestored by remember(sportsOnly) {
        mutableStateOf(false)
    }
    // === JS PLAYER TV MEMORY END ===
    // Lista única: categorias/pastas não participam mais da navegação ao vivo.
    val selected = ""
    var page by remember { mutableStateOf(StableCatalogPage(emptyList(), 0)) }
    var loading by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var retryNonce by remember { mutableIntStateOf(0) }

    var focusedItem by remember { mutableStateOf<StableCatalogItem?>(null) }
    var epgItemId by remember { mutableStateOf("") }
    var epg by remember { mutableStateOf(StableEpgState(null, null, 0f)) }
    var epgLoading by remember { mutableStateOf(false) }
    val channelListState = rememberLazyListState()
    val channelFocusRequester = remember { FocusRequester() }

    suspend fun load(reset: Boolean) {
        try {
            if (reset) loading = true else loadingMore = true
            error = ""

            val collected = mutableListOf<StableCatalogItem>()
            var offset = 0
            var expectedTotal = Int.MAX_VALUE

            // Busca todas as páginas para a ordenação A-Z ser realmente global.
            while (collected.size < expectedTotal && collected.size < 12000) {
                val result = StableApi.items(
                    "live",
                    "",
                    offset = offset,
                    limit = 240
                )

                if (result.items.isEmpty()) break

                collected += result.items
                expectedTotal = if (result.total > 0) result.total else collected.size
                offset = collected.size

                if (result.items.size < 240) break
            }

            var list = collected.distinctBy { it.id }

            if (sportsOnly) {
                val words = listOf(
                    "sport", "esporte", "futebol", "football",
                    "premiere", "espn", "combate", "sportv",
                    "dazn", "jogos"
                )
                list = list.filter { item ->
                    words.any { item.name.lowercase().contains(it) }
                }
            }

            list = list.sortedWith(
                compareBy<StableCatalogItem> {
                    it.name.trim().lowercase(Locale("pt", "BR"))
                }.thenBy { it.id }
            )

            page = StableCatalogPage(
                list,
                list.size
            )
        } catch (e: Exception) {
            error = e.message ?: "Falha ao carregar canais"
        } finally {
            loading = false
            loadingMore = false
        }
    }


    LaunchedEffect(selected, sportsOnly) {
        jsLastPrefs.edit()
            .putString(
                jsLastCategoryKey,
                selected
            )
            .apply()
    }

    LaunchedEffect(
        refreshKey,
        selected,
        sportsOnly,
        settingsRevision,
        retryNonce
    ) {
        focusedItem = null
        epgItemId = ""
        epg = StableEpgState(null, null, 0f)
        load(true)
    }

    LaunchedEffect(focusedItem?.id) {
        val item = focusedItem ?: return@LaunchedEffect

        
        // Troca imediata ao foco do controle.
        
        jsLastPrefs.edit()
            .putString(
                jsLastChannelKey,
                item.id
            )
            .putString(
                jsLastCategoryKey,
                item.categoryId
            )
            .putString(
                "last_live_name",
                item.name
            )
            .apply()

        onPreview(item)

        epgLoading = true
        epgItemId = item.id

        epg = runCatching {
            stableParseEpg(StableApi.liveEpg(item.id))
        }.getOrDefault(
            StableEpgState(null, null, 0f)
        )

        epgLoading = false
    }

    // === JS PLAYER LAST CHANNEL RESTORE START ===
    LaunchedEffect(
        page.items.size,
        page.total,
        selected,
        loading,
        sportsOnly
    ) {
        if (
            !jsLastRestored &&
            !loading &&
            page.items.isNotEmpty()
        ) {
            val savedChannel =
                jsLastPrefs.getString(
                    jsLastChannelKey,
                    ""
                ) ?: ""

            if (savedChannel.isNotBlank()) {
                val savedItem =
                    page.items.firstOrNull {
                        it.id == savedChannel
                    }

                when {
                    savedItem != null -> {
                        jsLastRestored = true
                        focusedItem = savedItem
                    }

                    else -> {
                        jsLastRestored = true
                    }
                }
            } else {
                jsLastRestored = true
            }
        }
    }
    // === JS PLAYER LAST CHANNEL RESTORE END ===

    LaunchedEffect(page.items.size, loading) {
        if (!loading && page.items.isNotEmpty()) {
            val savedChannel = jsLastPrefs.getString(jsLastChannelKey, "") ?: ""
            val index = page.items.indexOfFirst { it.id == savedChannel }
                .takeIf { it >= 0 } ?: 0

            channelListState.scrollToItem(index)
            delay(100)
            runCatching { channelFocusRequester.requestFocus() }
        }
    }


    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Transparent)
    ) {
        Column(
            Modifier
                .align(Alignment.CenterStart)
                .fillMaxHeight()
                .fillMaxWidth(0.42f)
                .padding(start = 10.dp, top = 10.dp, bottom = 10.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Color.Black.copy(alpha = 0.62f))
                .padding(7.dp)
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .padding(horizontal = 9.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    if (sportsOnly) "ESPORTES • A–Z" else "TODOS OS CANAIS • A–Z",
                    color = StableAccent,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    modifier = Modifier.weight(1f)
                )

                Text(
                    page.items.size.toString(),
                    color = Color.White.copy(alpha = .75f),
                    fontSize = 11.sp
                )
            }

            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color.Black.copy(alpha = 0.54f))
            ) {
                when {
                    loading -> {
                        CircularProgressIndicator(
                            color = StableAccent,
                            modifier = Modifier.align(Alignment.Center)
                        )
                    }

                    error.isNotBlank() -> {
                        Column(
                            Modifier
                                .align(Alignment.Center)
                                .padding(20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(error, color = Color.White, fontSize = 12.sp)

                            TextButton(onClick = { retryNonce++ }) {
                                Text("TENTAR NOVAMENTE", color = StableAccent)
                            }
                        }
                    }

                    else -> {
                        val savedChannel =
                            jsLastPrefs.getString(jsLastChannelKey, "") ?: ""
                        val focusTargetId =
                            savedChannel.takeIf { saved ->
                                page.items.any { it.id == saved }
                            } ?: page.items.firstOrNull()?.id.orEmpty()

                        LazyColumn(
                            state = channelListState,
                            modifier = Modifier.fillMaxSize()
                        ) {
                            items(
                                page.items,
                                key = { "${it.type}-${it.id}" }
                            ) { item ->
                                StableLiveRow(
                                    item = item,
                                    onPlay = onPlay,
                                    onDoublePlay = onDoublePlay,
                                    onFocus = { focusedItem = it },
                                    modifier = if (item.id == focusTargetId) {
                                        Modifier.focusRequester(channelFocusRequester)
                                    } else {
                                        Modifier
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }

        val selectedChannel = focusedItem

        if (selectedChannel != null) {
            Column(
                Modifier
                    .align(Alignment.BottomEnd)
                    .fillMaxWidth(0.40f)
                    .padding(end = 18.dp, bottom = 16.dp, start = 8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.Black.copy(alpha = 0.66f))
                    .padding(14.dp)
            ) {
                Text(
                    selectedChannel.name,
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(Modifier.height(8.dp))

                if (epgLoading && epgItemId == selectedChannel.id) {
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth(),
                        color = StableAccent
                    )
                } else if (epg.current != null) {
                    val current = epg.current!!

                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "AGORA",
                            color = StableAccent,
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.sp
                        )

                        Spacer(Modifier.width(8.dp))

                        Text(
                            listOf(current.startLabel, current.stopLabel)
                                .filter { it.isNotBlank() }
                                .joinToString(" - "),
                            color = Color.White.copy(alpha = 0.75f),
                            fontSize = 10.sp
                        )
                    }

                    Spacer(Modifier.height(4.dp))

                    Text(
                        current.title,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )

                    if (current.description.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            current.description,
                            color = Color.White.copy(alpha = 0.78f),
                            fontSize = 10.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    Spacer(Modifier.height(8.dp))

                    LinearProgressIndicator(
                        progress = { epg.progress },
                        modifier = Modifier.fillMaxWidth(),
                        color = StableAccent,
                        trackColor = Color.White.copy(alpha = 0.18f)
                    )

                    epg.next?.let { next ->
                        Spacer(Modifier.height(9.dp))
                        Text(
                            "A SEGUIR  ${next.startLabel}",
                            color = Color.White.copy(alpha = 0.60f),
                            fontSize = 9.sp
                        )
                        Text(
                            next.title,
                            color = Color.White.copy(alpha = 0.90f),
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                } else {
                    Text(
                        "EPG não disponível para este canal.",
                        color = Color.White.copy(alpha = 0.72f),
                        fontSize = 10.sp
                    )
                }
            }
        }
    }
}


@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun StableLiveRow(
    item: StableCatalogItem,
    onPlay: (StableCatalogItem) -> Unit,
    onDoublePlay: (StableCatalogItem) -> Unit,
    onFocus: (StableCatalogItem) -> Unit,
    modifier: Modifier = Modifier
) {
    var focused by remember(item.id) {
        mutableStateOf(false)
    }

    val shape =
        RoundedCornerShape(10.dp)

    Row(
        modifier
            .fillMaxWidth()
            .height(74.dp)
            .padding(
                horizontal = 5.dp,
                vertical = 3.dp
            )
            .clip(shape)
            .background(
                if (focused)
                    StableAccent.copy(
                        alpha = .18f
                    )
                else
                    Color.Black.copy(
                        alpha = .20f
                    )
            )
            .border(
                if (focused)
                    3.dp
                else
                    0.dp,
                if (focused)
                    StableAccent
                else
                    Color.Transparent,
                shape
            )
            .onFocusChanged { state ->
                focused =
                    state.isFocused

                if (
                    state.isFocused
                ) {
                    onFocus(item)
                }
            }
            .onPreviewKeyEvent { event ->
                if (
                    event.type ==
                    KeyEventType.KeyUp &&
                    (
                        event.key ==
                        Key.DirectionCenter ||
                        event.key ==
                        Key.Enter ||
                        event.key ==
                        Key.NumPadEnter
                    )
                ) {
                    onDoublePlay(item)
                    true
                } else {
                    false
                }
            }
            .combinedClickable(
                onClick = {
                    onPlay(item)
                },
                onDoubleClick = {
                    onDoublePlay(item)
                }
            )
            .jsPlayerTvFocus().focusable()
            .padding(8.dp),
        verticalAlignment =
            Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(6.dp)
                .fillMaxHeight()
                .clip(
                    RoundedCornerShape(
                        4.dp
                    )
                )
                .background(
                    if (focused)
                        StableAccent
                    else
                        Color.Transparent
                )
        )

        Spacer(
            Modifier.width(7.dp)
        )

        Box(
            Modifier
                .size(46.dp)
                .clip(
                    RoundedCornerShape(
                        8.dp
                    )
                )
                .background(
                    Color.Black.copy(
                        alpha = .38f
                    )
                ),
            contentAlignment =
                Alignment.Center
        ) {
            if (
                item.image.isNotBlank()
            ) {
                AsyncImage(
                    model = item.image,
                    contentDescription =
                        item.name,
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .padding(4.dp),
                    contentScale =
                        ContentScale.Fit
                )
            } else {
                Text("📺")
            }
        }

        Spacer(
            Modifier.width(11.dp)
        )

        Column(
            Modifier.weight(1f)
        ) {
            Text(
                item.name,
                color =
                    if (focused)
                        StableAccent
                    else
                        Color.White,
                fontWeight =
                    FontWeight.Bold,
                maxLines = 1,
                overflow =
                    TextOverflow.Ellipsis,
                fontSize = 12.sp
            )

            Text(
                if (focused)
                    "OK PARA ABRIR EM TELA CHEIA"
                else
                    "TV AO VIVO",
                color =
                    if (focused)
                        Color.White
                    else
                        Color.White.copy(
                            alpha = .65f
                        ),
                fontSize = 8.sp
            )
        }
    }
}

@Composable
private fun StableMovieScreen(
    refreshKey: Int,
    settingsRevision: Int,
    pending: StableCatalogItem?,
    onPendingConsumed: () -> Unit,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onPlay: (StableCatalogItem) -> Unit
) {
    StableMediaCatalogScreen(
        type = "movie",
        title = "FILMES",
        refreshKey = refreshKey,
        settingsRevision = settingsRevision,
        pending = pending,
        onPendingConsumed = onPendingConsumed,
        onBack = onBack,
        onSearch = onSearch,
        onPlayMovie = onPlay,
        onEpisode = { _, _ -> }
    )
}

@Composable
private fun StableSeriesScreen(
    refreshKey: Int,
    settingsRevision: Int,
    pending: StableCatalogItem?,
    onPendingConsumed: () -> Unit,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onEpisode: (StableEpisode, String) -> Unit
) {
    StableMediaCatalogScreen(
        type = "series",
        title = "SÉRIES",
        refreshKey = refreshKey,
        settingsRevision = settingsRevision,
        pending = pending,
        onPendingConsumed = onPendingConsumed,
        onBack = onBack,
        onSearch = onSearch,
        onPlayMovie = {},
        onEpisode = onEpisode
    )
}

@Composable
private fun StableMediaCatalogScreen(
    type: String,
    title: String,
    refreshKey: Int,
    settingsRevision: Int,
    pending: StableCatalogItem?,
    onPendingConsumed: () -> Unit,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onPlayMovie: (StableCatalogItem) -> Unit,
    onEpisode: (StableEpisode, String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var categories by remember { mutableStateOf<List<StableCategory>>(emptyList()) }
    var selectedCategory by remember { mutableStateOf("") }
    var page by remember { mutableStateOf(StableCatalogPage(emptyList(), 0)) }
    var initialized by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var retryNonce by remember { mutableIntStateOf(0) }

    var sortMode by remember { mutableStateOf("added") }
    var sortMenuOpen by remember { mutableStateOf(false) }

    var selectedItem by remember { mutableStateOf<StableCatalogItem?>(null) }
    var detail by remember { mutableStateOf<StableDetail?>(null) }
    var detailLoading by remember { mutableStateOf(false) }
    var episodes by remember { mutableStateOf<List<StableEpisode>>(emptyList()) }
    var episodesVisible by remember { mutableStateOf(false) }
    var episodeLoading by remember { mutableStateOf(false) }

    suspend fun load(reset: Boolean) {
        try {
            if (reset) loading = true else loadingMore = true
            error = ""

            if (!initialized) {
                var cats = StableApi.categories(type)
                val hide = if (type == "movie") {
                    StableSettings.bool(context, StableSettings.HIDE_VOD)
                } else {
                    StableSettings.bool(context, StableSettings.HIDE_SERIES)
                }
                if (hide) cats = cats.filterNot { isAdultCategory(it.name) }
                categories = cats
                initialized = true
            }

            val offset = if (reset) 0 else page.items.size
            val result = StableApi.items(
                type = type,
                categoryId = selectedCategory,
                offset = offset,
                limit = 240,
                sort = sortMode
            )
            page = if (reset) result else StableCatalogPage(page.items + result.items, result.total)
        } catch (e: Exception) {
            error = e.message ?: "Falha ao carregar $title"
        } finally {
            loading = false
            loadingMore = false
        }
    }

    fun openDetail(item: StableCatalogItem) {
        selectedItem = item
        detail = null
        episodes = emptyList()
        episodesVisible = false
        scope.launch {
            detailLoading = true
            try {
                detail = if (type == "movie") {
                    StableApi.movieDetail(item.id)
                } else {
                    StableApi.seriesDetail(item.id)
                }
            } catch (e: Exception) {
                error = e.message ?: "Falha ao abrir detalhes"
            } finally {
                detailLoading = false
            }
        }
    }

    fun loadEpisodes(item: StableCatalogItem) {
        episodesVisible = true
        if (episodes.isNotEmpty()) return
        scope.launch {
            episodeLoading = true
            try {
                episodes = StableApi.seriesEpisodes(item.id)
            } catch (e: Exception) {
                error = e.message ?: "Falha ao carregar episódios"
            } finally {
                episodeLoading = false
            }
        }
    }

    LaunchedEffect(refreshKey, settingsRevision, retryNonce) {
        initialized = false
        selectedItem = null
        detail = null
        load(true)
    }

    LaunchedEffect(selectedCategory, sortMode) {
        if (initialized && selectedItem == null) load(true)
    }

    LaunchedEffect(pending?.id) {
        if (pending != null) {
            openDetail(pending)
            onPendingConsumed()
        }
    }

    if (selectedItem != null) {
        val item = selectedItem!!
        StableMediaDetailScreen(
            item = item,
            detail = detail,
            loading = detailLoading,
            episodes = episodes,
            episodesVisible = episodesVisible,
            episodeLoading = episodeLoading,
            onBack = {
                selectedItem = null
                detail = null
                episodes = emptyList()
                episodesVisible = false
            },
            onPlayMovie = {
                onPlayMovie(item)
            },
            onShowEpisodes = {
                loadEpisodes(item)
            },
            onEpisode = { ep ->
                onEpisode(ep, detail?.name?.ifBlank { item.name } ?: item.name)
            }
        )
        return
    }

    Row(Modifier.fillMaxSize().background(StablePanel)) {
        StableMediaSidebar(
            type = type,
            categories = categories,
            selected = selectedCategory,
            total = page.total,
            onCategory = { selectedCategory = it },
            onBack = onBack,
            onSearch = onSearch,
            modifier = Modifier.width(220.dp).fillMaxHeight()
        )

        Column(Modifier.weight(1f).fillMaxHeight()) {
            Row(
                Modifier.fillMaxWidth().height(58.dp).background(StableBrown).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box {
                    OutlinedButton(onClick = { sortMenuOpen = true }) {
                        Text(sortLabel(sortMode), color = Color.White, fontSize = 11.sp)
                        Spacer(Modifier.width(6.dp))
                        Text("⌄", color = StableAccent)
                    }

                    DropdownMenu(
                        expanded = sortMenuOpen,
                        onDismissRequest = { sortMenuOpen = false }
                    ) {
                        sortOptions().forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option.second) },
                                onClick = {
                                    sortMode = option.first
                                    sortMenuOpen = false
                                }
                            )
                        }
                    }
                }

                Spacer(Modifier.weight(1f))
                Text(
                    "Todos (${page.total})",
                    color = Color.White,
                    fontSize = 13.sp
                )
            }

            when {
                loading -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = StableAccent)
                }

                error.isNotBlank() -> StableError(error) {
                    initialized = false
                    retryNonce++
                }

                else -> {
                    val listMode = StableSettings.bool(context, StableSettings.LIST_MODE)
                    val compact = StableSettings.bool(context, StableSettings.COMPACT_LAYOUT)

                    if (listMode) {
                        LazyColumn(Modifier.fillMaxSize()) {
                            items(page.items, key = { "${it.type}-${it.id}" }) { item ->
                                StableCatalogListRow(item) { openDetail(it) }
                            }
                            if (page.items.size < page.total) {
                                item { StableLoadMore(loadingMore) { loadingMore = true } }
                            }
                        }
                    } else {
                        LazyVerticalGrid(
                            columns = GridCells.Adaptive(if (compact) 92.dp else 122.dp),
                            contentPadding = PaddingValues(10.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.fillMaxSize()
                        ) {
                            gridItems(page.items, key = { "${it.type}-${it.id}" }) { item ->
                                StablePoster(item) { openDetail(it) }
                            }
                            if (page.items.size < page.total) {
                                item { StableLoadMore(loadingMore) { loadingMore = true } }
                            }
                        }
                    }

                    LaunchedEffect(loadingMore) {
                        if (loadingMore) load(false)
                    }
                }
            }
        }
    }
}

private fun sortOptions(): List<Pair<String, String>> = listOf(
    "number" to "Ordenar por número",
    "added" to "Ordenar por adicionado",
    "rating" to "Ordenar por classificação",
    "az" to "Ordenar A-Z",
    "za" to "Ordenar Z-A"
)

private fun sortLabel(value: String): String =
    sortOptions().firstOrNull { it.first == value }?.second ?: "Ordenar por adicionado"

@Composable
private fun StableMediaDetailScreen(
    item: StableCatalogItem,
    detail: StableDetail?,
    loading: Boolean,
    episodes: List<StableEpisode>,
    episodesVisible: Boolean,
    episodeLoading: Boolean,
    onBack: () -> Unit,
    onPlayMovie: () -> Unit,
    onShowEpisodes: () -> Unit,
    onEpisode: (StableEpisode) -> Unit
) {
    val d = detail
    Box(Modifier.fillMaxSize().background(Color(0xFF070B0D))) {
        val backdrop = d?.backdrop
            ?.ifBlank { d.cover.ifBlank { item.image } }
            ?: item.image
        if (backdrop.isNotBlank()) {
            AsyncImage(
                model = backdrop,
                contentDescription = d?.name ?: item.name,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
        }

        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    listOf(
                        Color.Black.copy(alpha = .28f),
                        Color.Black.copy(alpha = .76f),
                        Color.Black.copy(alpha = .96f)
                    )
                )
            )
        )

        Text(
            "←",
            color = Color.White,
            fontSize = 30.sp,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(20.dp)
                .clickable(onClick = onBack)
                .padding(8.dp)
        )

        if (loading) {
            CircularProgressIndicator(
                color = StableAccent,
                modifier = Modifier.align(Alignment.Center)
            )
            return@Box
        }

        Row(
            Modifier.fillMaxSize().padding(start = 72.dp, top = 78.dp, end = 50.dp, bottom = 30.dp),
            horizontalArrangement = Arrangement.spacedBy(28.dp)
        ) {
            Box(
                Modifier.width(190.dp).fillMaxHeight(.72f)
                    .clip(RoundedCornerShape(8.dp))
                    .background(StablePanel2)
            ) {
                val cover = d?.cover?.ifBlank { item.image } ?: item.image
                if (cover.isNotBlank()) {
                    AsyncImage(
                        model = cover,
                        contentDescription = d?.name ?: item.name,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                }
            }

            Column(Modifier.weight(1f).fillMaxHeight()) {
                Button(
                    onClick = if (item.type == "movie") onPlayMovie else onShowEpisodes,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF171717))
                ) {
                    Text(
                        if (item.type == "movie") "▶  ASSISTA AGORA" else "▶  ASSISTIR TEMPORADA",
                        color = Color.White,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(Modifier.height(18.dp))

                Text(
                    d?.name?.ifBlank { item.name } ?: item.name,
                    color = Color.White,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.Medium
                )

                Spacer(Modifier.height(8.dp))

                val meta = listOfNotNull(
                    d?.year?.takeIf { it.isNotBlank() },
                    d?.genre?.takeIf { it.isNotBlank() },
                    d?.country?.takeIf { it.isNotBlank() }
                ).joinToString("   ")

                if (meta.isNotBlank()) {
                    Text(meta, color = Color.White.copy(alpha = .78f), fontSize = 12.sp)
                }

                if (!d?.director.isNullOrBlank()) {
                    Spacer(Modifier.height(7.dp))
                    Text("Direção: ${d?.director}", color = Color.White.copy(alpha = .78f), fontSize = 12.sp)
                }

                if (!d?.rating.isNullOrBlank()) {
                    Spacer(Modifier.height(7.dp))
                    Text("★  ${d?.rating}", color = Color(0xFFFFC83D), fontSize = 13.sp)
                }

                if (!d?.added.isNullOrBlank()) {
                    Spacer(Modifier.height(7.dp))
                    Text("data adicionada: ${d?.added}", color = Color.White.copy(alpha = .72f), fontSize = 11.sp)
                }

                if (!d?.plot.isNullOrBlank()) {
                    Spacer(Modifier.height(16.dp))
                    Text(
                        d?.plot.orEmpty(),
                        color = Color.White.copy(alpha = .88f),
                        fontSize = 13.sp,
                        maxLines = 6,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                if (!d?.cast.isNullOrBlank()) {
                    Spacer(Modifier.height(22.dp))
                    Text("Elenco:", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(7.dp))
                    Text(
                        d?.cast.orEmpty(),
                        color = Color.White.copy(alpha = .80f),
                        fontSize = 12.sp,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                if (item.type == "series" && episodesVisible) {
                    Spacer(Modifier.height(18.dp))
                    Text("EPISÓDIOS", color = StableAccent, fontWeight = FontWeight.Bold, fontSize = 13.sp)

                    if (episodeLoading) {
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            color = StableAccent
                        )
                    } else {
                        LazyColumn(
                            Modifier.fillMaxWidth().weight(1f).padding(top = 8.dp)
                        ) {
                            items(episodes, key = { it.id }) { ep ->
                                Row(
                                    Modifier.fillMaxWidth()
                                        .padding(vertical = 4.dp)
                                        .clip(RoundedCornerShape(7.dp))
                                        .background(Color.Black.copy(alpha = .48f))
                                        .clickable { onEpisode(ep) }
                                        .padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        "T${ep.season}",
                                        color = StableAccent,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.width(48.dp)
                                    )
                                    Text(
                                        ep.title,
                                        color = Color.White,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StableSearchPage(
    query: String,
    onQuery: (String) -> Unit,
    onBack: () -> Unit,
    onClick: (StableCatalogItem) -> Unit
) {
    Column(Modifier.fillMaxSize().background(StableBg).padding(18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "←  Voltar",
                color = Color.White,
                modifier = Modifier.clickable(onClick = onBack).padding(10.dp)
            )
            Spacer(Modifier.width(12.dp))
            OutlinedTextField(
                value = query,
                onValueChange = onQuery,
                singleLine = true,
                placeholder = {
                    Text("Pesquisar canais, filmes e séries...", color = StableMuted)
                },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(24.dp)
            )
        }
        Spacer(Modifier.height(12.dp))
        if (query.trim().length >= 2) {
            StableGlobalSearch(query, onClick)
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Digite pelo menos 2 letras", color = StableMuted)
            }
        }
    }
}

@Composable
private fun StableBrowserShell(
    title: String,
    categories: List<StableCategory>,
    selected: String,
    onCategory: (String) -> Unit,
    loading: Boolean,
    error: String,
    onRetry: () -> Unit,
    content: @Composable () -> Unit
) {
    Row(Modifier.fillMaxSize().background(StablePanel)) {
        StableCategorySidebar(title, categories, selected, onCategory, Modifier.width(190.dp))
        Box(Modifier.weight(1f).fillMaxHeight()) {
            when {
                loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = StableAccent) }
                error.isNotBlank() -> StableError(error, onRetry)
                else -> content()
            }
        }
    }
}

@Composable
private fun StableMediaSidebar(
    type: String,
    categories: List<StableCategory>,
    selected: String,
    total: Int,
    onCategory: (String) -> Unit,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier
) {
    val iconRes = if (type == "movie") R.drawable.home_movies else R.drawable.home_series

    Column(modifier.background(Color(0xFF090C12))) {
        Box(
            Modifier.fillMaxWidth().height(118.dp).background(Color(0xFF080A0F)),
            contentAlignment = Alignment.Center
        ) {
            Image(
                painter = painterResource(iconRes),
                contentDescription = if (type == "movie") "Filmes" else "Séries",
                modifier = Modifier.width(118.dp).height(92.dp),
                contentScale = ContentScale.Fit
            )
        }

        Row(
            Modifier.fillMaxWidth().height(42.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                "↩ Voltar",
                color = Color.White,
                fontSize = 12.sp,
                modifier = Modifier.clickable(onClick = onBack).padding(6.dp)
            )
            Text(
                "⌕ Procurar",
                color = Color.White,
                fontSize = 12.sp,
                modifier = Modifier.clickable(onClick = onSearch).padding(6.dp)
            )
        }

        StableMediaReferenceRow("Retomar para Assistir", 0, false) { }
        StableMediaReferenceRow("Todos", total, selected.isBlank()) { onCategory("") }
        StableMediaReferenceRow("Favorito", 0, false) { }

        LazyColumn(Modifier.fillMaxSize()) {
            items(categories, key = { it.id }) { cat ->
                StableMediaReferenceRow(
                    cat.name,
                    cat.count,
                    selected == cat.id
                ) {
                    onCategory(cat.id)
                }
            }
        }
    }
}

@Composable
private fun StableMediaReferenceRow(
    name: String,
    count: Int,
    selected: Boolean,
    onClick: () -> Unit
) {
    var focused by remember(name) {
        mutableStateOf(false)
    }

    val shape =
        RoundedCornerShape(8.dp)

    Row(
        Modifier
            .fillMaxWidth()
            .height(45.dp)
            .padding(
                horizontal = 4.dp,
                vertical = 2.dp
            )
            .clip(shape)
            .background(
                when {
                    focused ->
                        StableAccent.copy(
                            alpha = .20f
                        )
                    selected ->
                        Color(0xFF171A11)
                    else ->
                        Color(0xFF101010)
                }
            )
            .border(
                width =
                    when {
                        focused -> 3.dp
                        selected -> 1.dp
                        else -> 0.dp
                    },
                color =
                    when {
                        focused ->
                            StableAccent
                        selected ->
                            StableAccent.copy(
                                alpha = .65f
                            )
                        else ->
                            Color.Transparent
                    },
                shape = shape
            )
            .onFocusChanged { state ->
                focused =
                    state.isFocused
            }
            .onPreviewKeyEvent { event ->
                if (
                    event.type ==
                    KeyEventType.KeyUp &&
                    (
                        event.key ==
                        Key.DirectionCenter ||
                        event.key ==
                        Key.Enter ||
                        event.key ==
                        Key.NumPadEnter
                    )
                ) {
                    onClick()
                    true
                } else {
                    false
                }
            }
            .clickable(
                onClick = onClick
            )
            .jsPlayerTvFocus().focusable()
            .padding(
                horizontal = 10.dp
            ),
        verticalAlignment =
            Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(6.dp)
                .height(28.dp)
                .clip(
                    RoundedCornerShape(
                        4.dp
                    )
                )
                .background(
                    if (
                        focused ||
                        selected
                    )
                        StableAccent
                    else
                        Color.Transparent
                )
        )

        Spacer(
            Modifier.width(8.dp)
        )

        Text(
            name,
            color =
                if (
                    focused ||
                    selected
                )
                    StableAccent
                else
                    Color.White,
            fontSize = 11.sp,
            fontWeight =
                if (
                    focused ||
                    selected
                )
                    FontWeight.Bold
                else
                    FontWeight.Normal,
            maxLines = 1,
            overflow =
                TextOverflow.Ellipsis,
            modifier =
                Modifier.weight(1f)
        )

        Text(
            count.toString(),
            color =
                if (
                    focused ||
                    selected
                )
                    StableAccent
                else
                    Color.White.copy(
                        alpha = .82f
                    ),
            fontSize = 10.sp,
            fontWeight =
                if (focused)
                    FontWeight.Bold
                else
                    FontWeight.Normal
        )
    }
}

@Composable
private fun StableCategorySidebar(
    title: String,
    categories: List<StableCategory>,
    selected: String,
    onCategory: (String) -> Unit,
    modifier: Modifier
) {
    val total = categories.sumOf { it.count }
    Column(modifier.fillMaxHeight().background(Color(0xFF090C12))) {
        if (title.isNotBlank()) {
            Row(
                Modifier.fillMaxWidth().height(60.dp).background(StableBrown).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Text(categories.size.toString(), color = Color(0xFFD9A56D), fontSize = 11.sp)
            }
        }
        StableCategoryButton("TODOS", total, selected.isBlank()) { onCategory("") }
        LazyColumn(Modifier.fillMaxSize()) {
            items(categories, key = { it.id }) { cat ->
                StableCategoryButton(cat.name, cat.count, selected == cat.id) { onCategory(cat.id) }
            }
        }
    }
}

@Composable
private fun StableCategoryButton(name: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 7.dp, vertical = 3.dp).clip(RoundedCornerShape(7.dp))
            .background(StablePanel2).border(if (selected) 1.dp else 0.dp, if (selected) StableOrange else Color.Transparent, RoundedCornerShape(7.dp))
            .clickable(onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.width(5.dp).height(28.dp).clip(RoundedCornerShape(3.dp)).background(if (selected) StableAccent else Color.Gray))
        Spacer(Modifier.width(10.dp))
        Text(name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (count > 0) {
            Text(count.toString(), color = Color.White.copy(alpha = .75f), fontSize = 10.sp)
        }
    }
}

@Composable
private fun StablePoster(
    item: StableCatalogItem,
    onClick: (StableCatalogItem) -> Unit
) {
    var focused by remember(item.id) {
        mutableStateOf(false)
    }

    val shape =
        RoundedCornerShape(10.dp)

    Column(
        Modifier
            .padding(2.dp)
            .clip(shape)
            .background(
                if (focused)
                    StableAccent.copy(
                        alpha = .13f
                    )
                else
                    StablePanel2
            )
            .border(
                if (focused)
                    3.dp
                else
                    1.dp,
                if (focused)
                    StableAccent
                else
                    Color.White.copy(
                        alpha = .04f
                    ),
                shape
            )
            .onFocusChanged { state ->
                focused =
                    state.isFocused
            }
            .onPreviewKeyEvent { event ->
                if (
                    event.type ==
                    KeyEventType.KeyUp &&
                    (
                        event.key ==
                        Key.DirectionCenter ||
                        event.key ==
                        Key.Enter ||
                        event.key ==
                        Key.NumPadEnter
                    )
                ) {
                    onClick(item)
                    true
                } else {
                    false
                }
            }
            .clickable {
                onClick(item)
            }
            .jsPlayerTvFocus().focusable()
            .padding(5.dp)
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(.68f)
                .clip(
                    RoundedCornerShape(
                        8.dp
                    )
                )
                .background(
                    Color(0xFF0B0E14)
                )
        ) {
            if (
                item.image.isNotBlank()
            ) {
                AsyncImage(
                    item.image,
                    item.name,
                    Modifier.fillMaxSize(),
                    contentScale =
                        ContentScale.Crop
                )
            } else {
                Text(
                    if (
                        item.type ==
                        "series"
                    )
                        "🎞"
                    else
                        "🎬",
                    fontSize = 36.sp,
                    modifier =
                        Modifier.align(
                            Alignment.Center
                        )
                )
            }
        }

        Text(
            item.name,
            color =
                if (focused)
                    StableAccent
                else
                    Color.White,
            fontSize = 10.sp,
            fontWeight =
                if (focused)
                    FontWeight.Bold
                else
                    FontWeight.Medium,
            maxLines = 2,
            overflow =
                TextOverflow.Ellipsis,
            modifier =
                Modifier.padding(
                    5.dp
                )
        )
    }
}

@Composable
private fun StableCatalogListRow(
    item: StableCatalogItem,
    onClick: (StableCatalogItem) -> Unit
) {
    var focused by remember(item.id) {
        mutableStateOf(false)
    }

    val shape =
        RoundedCornerShape(9.dp)

    Row(
        Modifier
            .fillMaxWidth()
            .padding(
                horizontal = 8.dp,
                vertical = 4.dp
            )
            .height(70.dp)
            .clip(shape)
            .background(
                if (focused)
                    StableAccent.copy(
                        alpha = .18f
                    )
                else
                    StablePanel2
            )
            .border(
                if (focused)
                    3.dp
                else
                    0.dp,
                if (focused)
                    StableAccent
                else
                    Color.Transparent,
                shape
            )
            .onFocusChanged { state ->
                focused =
                    state.isFocused
            }
            .onPreviewKeyEvent { event ->
                if (
                    event.type ==
                    KeyEventType.KeyUp &&
                    (
                        event.key ==
                        Key.DirectionCenter ||
                        event.key ==
                        Key.Enter ||
                        event.key ==
                        Key.NumPadEnter
                    )
                ) {
                    onClick(item)
                    true
                } else {
                    false
                }
            }
            .clickable {
                onClick(item)
            }
            .jsPlayerTvFocus().focusable()
            .padding(8.dp),
        verticalAlignment =
            Alignment.CenterVertically
    ) {
        if (
            item.image.isNotBlank()
        ) {
            AsyncImage(
                item.image,
                item.name,
                Modifier
                    .width(44.dp)
                    .fillMaxHeight()
                    .clip(
                        RoundedCornerShape(
                            5.dp
                        )
                    ),
                contentScale =
                    ContentScale.Crop
            )
        }

        Spacer(
            Modifier.width(10.dp)
        )

        Text(
            item.name,
            color =
                if (focused)
                    StableAccent
                else
                    Color.White,
            fontWeight =
                FontWeight.Bold,
            maxLines = 2,
            overflow =
                TextOverflow.Ellipsis,
            fontSize = 12.sp
        )
    }
}

@Composable
private fun StableLoadMore(loading: Boolean, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = !loading, modifier = Modifier.fillMaxWidth().padding(8.dp)) {
        Text(if (loading) "CARREGANDO..." else "CARREGAR MAIS", color = StableAccent)
    }
}

@Composable
private fun StableError(message: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("Não foi possível carregar", color = Color.White, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text(message, color = StableMuted, fontSize = 11.sp, maxLines = 3)
        Spacer(Modifier.height(10.dp))
        Button(onClick = onRetry) { Text("TENTAR NOVAMENTE") }
    }
}

@Composable
private fun StableGlobalSearch(query: String, onClick: (StableCatalogItem) -> Unit) {
    var results by remember { mutableStateOf<List<StableCatalogItem>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    LaunchedEffect(query) {
        delay(350)
        if (query.trim().length < 2) return@LaunchedEffect
        loading = true
        error = ""
        try { results = StableApi.search(query) }
        catch (e: Exception) { error = e.message ?: "Falha na pesquisa" }
        finally { loading = false }
    }

    Column(Modifier.fillMaxSize().background(StableBg).padding(18.dp)) {
        Text("RESULTADOS GERAIS", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text("Canais, filmes e séries", color = StableMuted, fontSize = 11.sp)
        Spacer(Modifier.height(12.dp))
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = StableAccent)
        if (error.isNotBlank()) Text(error, color = Color(0xFFFF7070), modifier = Modifier.padding(10.dp))
        LazyVerticalGrid(
            columns = GridCells.Adaptive(150.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            gridItems(results, key = { "${it.type}-${it.id}" }) { item ->
                Row(
                    Modifier.height(78.dp).clip(RoundedCornerShape(9.dp)).background(StablePanel2).clickable { onClick(item) }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (item.image.isNotBlank()) AsyncImage(item.image, item.name, Modifier.width(48.dp).fillMaxHeight().clip(RoundedCornerShape(6.dp)), contentScale = ContentScale.Crop)
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(item.name, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 11.sp)
                        Text(when (item.type) { "live" -> "CANAL"; "movie" -> "FILME"; else -> "SÉRIE" }, color = StableAccent, fontSize = 9.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun StableProfileScreen(
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onCheckUpdate: () -> Unit
) {
    val context = LocalContext.current
    val packageInfo = remember {
        context.packageManager.getPackageInfo(context.packageName, 0)
    }
    val version = packageInfo.versionName ?: ""
    val source = StableApi.sourceName.ifBlank { "Servidor automático" }

    Column(Modifier.fillMaxSize().background(StableBg)) {
        Row(
            Modifier.fillMaxWidth().height(70.dp).padding(horizontal = 22.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("←", color = Color.White, fontSize = 28.sp, modifier = Modifier.clickable(onClick = onBack).padding(8.dp))
            Spacer(Modifier.width(12.dp))
            Text("Perfil", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }

        Column(
            Modifier.widthIn(max = 620.dp).fillMaxWidth().padding(28.dp)
                .clip(RoundedCornerShape(14.dp)).background(StablePanel2).padding(24.dp)
        ) {
            Text("JS PLAYER", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(18.dp))
            Text("Servidor conectado", color = StableMuted, fontSize = 11.sp)
            Text(source, color = StableAccent, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(14.dp))
            Text("Versão do aplicativo", color = StableMuted, fontSize = 11.sp)
            Text(version, color = Color.White, fontSize = 15.sp)
            Spacer(Modifier.height(24.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = onRefresh) { Text("RECARREGAR LISTA") }
                OutlinedButton(onClick = onCheckUpdate) { Text("VERIFICAR ATUALIZAÇÃO") }
            }
        }
    }
}

@Composable
private fun StableSettingsScreen(
    revision: Int,
    onBack: () -> Unit,
    onChanged: () -> Unit,
    onReconnect: () -> Unit,
    onRefreshCatalogs: () -> Unit
) {
    val context = LocalContext.current
    var localRevision by remember(revision) { mutableIntStateOf(revision) }
    val revisionTick = localRevision // mantém os estados visuais dos botões sincronizados

    fun toggle(key: String, default: Boolean = false, label: String) {
        val value = StableSettings.toggle(context, key, default)
        localRevision++
        onChanged()
        Toast.makeText(context, "$label: ${if (value) "ATIVADO" else "DESATIVADO"}", Toast.LENGTH_SHORT).show()
    }

    data class Action(val title: String, val icon: String, val status: String = "", val click: () -> Unit)

    val actions = listOf(
        Action("Controle dos pais", "🔒", if (StableSettings.bool(context, StableSettings.PARENTAL)) "ATIVO" else "DESATIVADO") { toggle(StableSettings.PARENTAL, false, "Controle dos pais") },
        Action("Recarregar lista / servidor", "↻") { onReconnect() },
        Action("Mudar idioma", "文", StableSettings.language(context).uppercase()) {
            val lang = StableSettings.toggleLanguage(context); localRevision++; onChanged(); Toast.makeText(context, "Idioma: ${lang.uppercase()}", Toast.LENGTH_SHORT).show()
        },
        Action("ALTERAR LAYOUT", "▦", if (StableSettings.bool(context, StableSettings.COMPACT_LAYOUT)) "COMPACTO" else "PADRÃO") { toggle(StableSettings.COMPACT_LAYOUT, false, "Layout compacto") },
        Action("Ocultar categorias ao vivo", "◉", if (StableSettings.bool(context, StableSettings.HIDE_LIVE)) "ATIVO" else "DESATIVADO") { toggle(StableSettings.HIDE_LIVE, false, "Ocultar adulto ao vivo") },
        Action("Ocultar categorias de Vod", "◉", if (StableSettings.bool(context, StableSettings.HIDE_VOD)) "ATIVO" else "DESATIVADO") { toggle(StableSettings.HIDE_VOD, false, "Ocultar adulto VOD") },
        Action("Ocultar categorias de Séries", "◉", if (StableSettings.bool(context, StableSettings.HIDE_SERIES)) "ATIVO" else "DESATIVADO") { toggle(StableSettings.HIDE_SERIES, false, "Ocultar adulto Séries") },
        Action("Limpar canais de histórico", "⌫") { StableSettings.clearRecent(context, "live"); Toast.makeText(context, "Histórico de canais limpo", Toast.LENGTH_SHORT).show() },
        Action("Limpar histórico de filmes", "⌫") { StableSettings.clearRecent(context, "movie"); Toast.makeText(context, "Histórico de filmes limpo", Toast.LENGTH_SHORT).show() },
        Action("Limpar série de histórico", "⌫") { StableSettings.clearRecent(context, "series"); Toast.makeText(context, "Histórico de séries limpo", Toast.LENGTH_SHORT).show() },
        Action("classificação ao vivo", "A↕", if (StableSettings.bool(context, StableSettings.SORT_LIVE)) "A-Z" else "SERVIDOR") { toggle(StableSettings.SORT_LIVE, false, "Ordenação") },
        Action("FORMATO DA LISTA", "▤", if (StableSettings.bool(context, StableSettings.LIST_MODE)) "LISTA" else "CAPAS") { toggle(StableSettings.LIST_MODE, false, "Formato da lista") },
        Action("Leitor externo", "▶", if (StableSettings.bool(context, StableSettings.EXTERNAL_PLAYER)) "ATIVO" else "INTERNO") { toggle(StableSettings.EXTERNAL_PLAYER, false, "Leitor externo") },
        Action("Automático", "⟳", if (StableSettings.bool(context, StableSettings.AUTO_REFRESH, true)) "ATIVO" else "DESATIVADO") { toggle(StableSettings.AUTO_REFRESH, true, "Atualização automática") },
        Action("Formato de hora", "◷", if (StableSettings.bool(context, StableSettings.CLOCK_24, true)) "24H" else "12H") { toggle(StableSettings.CLOCK_24, true, "Formato de hora") },
        Action("Configurações de legenda", "▱", if (StableSettings.bool(context, StableSettings.SUBTITLES, true)) "ATIVA" else "DESATIVADA") { toggle(StableSettings.SUBTITLES, true, "Legenda") },
        Action("ALTERAR MODO", "▣", "INTERNO") { toggle(StableSettings.COMPACT_LAYOUT, false, "Modo") },
        Action("Atualizar agora", "⇩") { onRefreshCatalogs(); AppUpdater.check(context, true) }
    )

    Column(Modifier.fillMaxSize().background(StableBg)) {
        Row(Modifier.fillMaxWidth().height(70.dp).padding(horizontal = 22.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("←", color = Color.White, fontSize = 28.sp, modifier = Modifier.clickable(onClick = onBack).padding(8.dp))
            Spacer(Modifier.width(12.dp))
            Text("Configurações", color = Color.White, fontSize = 22.sp)
        }
        LazyVerticalGrid(
            columns = GridCells.Fixed(4),
            contentPadding = PaddingValues(20.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            gridItems(actions, key = { it.title }) { action ->
                Row(
                    Modifier.height(66.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFF171717))
                        .clickable { action.click() }.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(action.icon, color = Color.White, fontSize = 20.sp, modifier = Modifier.width(34.dp))
                    Column(Modifier.weight(1f)) {
                        Text(action.title, color = Color.White, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (action.status.isNotBlank()) Text(action.status, color = StableAccent, fontSize = 8.sp)
                    }
                }
            }
        }
    }
}
