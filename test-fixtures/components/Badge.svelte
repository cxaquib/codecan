<script lang="ts">
  let count = $state(0);
  let label = $state("");

  onMount(() => {
    fetch("/api/badge-count").then(r => r.json()).then(d => count = d.count);
  });

  function handleClick() {
    count++;
  }
</script>

<button onclick={handleClick}>
  {label}: {count}
</button>