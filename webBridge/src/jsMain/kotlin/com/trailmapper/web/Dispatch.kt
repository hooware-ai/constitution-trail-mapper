@file:OptIn(ExperimentalJsExport::class)

package com.trailmapper.web

private val bridge = WebRoutingBridge()

@JsExport
fun dispatch(requestJson: String): String = bridge.dispatch(requestJson)
