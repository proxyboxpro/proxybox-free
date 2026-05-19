<script setup>
import { onMounted } from 'vue'
import { fetchMe } from './api'

onMounted(() => {
  fetchMe()
})
</script>

<template>
  <RouterView />
</template>
