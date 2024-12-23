// script.js

let supabase; // We'll create it after fetching /config
let messagesSubscription;

// Store color info for each username in memory
const userColorMap = {};

/************************************************************
 * 1. HTML ELEMENTS
 ************************************************************/
const connectWalletBtn = document.getElementById("connectWalletBtn");
const messagesList = document.getElementById("messagesList");
const chatContainer = document.getElementById("chatContainer");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

// Warning/error area (used for slow mode or other short messages)
const slowModeWarning = document.getElementById("slowModeWarning");

/************************************************************
 * 2. HELPER FUNCTIONS
 ************************************************************/

/**
 * Show a short warning message in the #slowModeWarning area
 * with optional shake animation.
 */
function showWarning(msg, doShake = false) {
  slowModeWarning.textContent = msg;
  slowModeWarning.style.display = "block";

  if (doShake) {
    slowModeWarning.classList.add("shake");
    setTimeout(() => slowModeWarning.classList.remove("shake"), 300);
  }

  // Hide the warning after 1.5s
  setTimeout(() => {
    slowModeWarning.style.display = "none";
  }, 1500);
}

/**
 * Generates a random username in the format "UserXXXX".
 */
function generateRandomUsername() {
  const randomId = Math.floor(1000 + Math.random() * 9000);
  return "User" + randomId;
}

/**
 * Returns a random hex color string, e.g. "#3f2abc".
 */
function generateRandomColor() {
  return "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");
}

/**
 * Retrieves or creates a user in "users" table.
 */
async function getOrCreateUser(publicKey) {
  // Check localStorage first
  let existingUser = JSON.parse(localStorage.getItem("myLivechatUser"));
  if (existingUser && existingUser.walletpublickey === publicKey) {
    return existingUser;
  }

  // Query Supabase
  const { data: userRecord, error } = await supabase
    .from("users")
    .select("*")
    .eq("walletpublickey", publicKey)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error fetching user:", error);
  }

  if (userRecord) {
    localStorage.setItem("myLivechatUser", JSON.stringify(userRecord));
    return userRecord;
  } else {
    // Create new user
    const newUsername = generateRandomUsername();
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert([{ walletpublickey: publicKey, username: newUsername }])
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting user:", insertError);
      alert("Failed to create user in database.");
      return null;
    }
    localStorage.setItem("myLivechatUser", JSON.stringify(newUser));
    return newUser;
  }
}

/**
 * Assign a random color to a username if not already stored.
 */
function assignUserColor(username) {
  if (!userColorMap[username]) {
    userColorMap[username] = generateRandomColor();
  }
  return userColorMap[username];
}

/**
 * Adds a new message to the chat UI.
 */
function addMessageToUI(username, content) {
  // Assign color to the username if not present
  const color = assignUserColor(username);

  const li = document.createElement("li");

  const userSpan = document.createElement("span");
  userSpan.textContent = username + ":";
  userSpan.classList.add("username");
  userSpan.style.color = color;

  const contentSpan = document.createElement("span");
  contentSpan.textContent = " " + content;

  li.appendChild(userSpan);
  li.appendChild(contentSpan);
  messagesList.appendChild(li);

  // Auto-scroll to the latest message
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Fetch existing messages from Supabase (last 50 only) and display them.
 */
async function fetchExistingMessages() {
  const { data: messages, error } = await supabase
    .from("messages")
    .select("content, created_at, user_id, users(username)")
    .order("created_at", { ascending: false }) // get newest first
    .limit(50); // only get last 50 messages

  if (error) {
    console.error("Error fetching messages:", error);
    return;
  }

  // We got the newest 50 in reverse order; reverse them for chronological display
  const reversed = messages.reverse();
  reversed.forEach((msg) => {
    addMessageToUI(msg.users.username, msg.content);
  });
}

/**
 * Subscribes to real-time message inserts.
 */
function subscribeToMessages() {
  messagesSubscription = supabase
    .channel("public:messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const newMsg = payload.new;
        if (!newMsg) return;
        fetchUserAndRenderMessage(newMsg);
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("Realtime subscription is active for messages.");
      }
    });
}

/**
 * Fetch username for a new message and display it.
 */
async function fetchUserAndRenderMessage(msgRow) {
  const { data: userData, error } = await supabase
    .from("users")
    .select("username")
    .eq("id", msgRow.user_id)
    .single();

  if (error) {
    console.error("Error fetching user for message:", error);
    return;
  }
  addMessageToUI(userData.username, msgRow.content);
}

/************************************************************
 * 3. EVENT HANDLERS
 ************************************************************/

/**
 * Connect Phantom Wallet button
 */
connectWalletBtn.addEventListener("click", async () => {
  if (window.solana && window.solana.isPhantom) {
    try {
      const response = await window.solana.connect({ onlyIfTrusted: false });
      const publicKey = response.publicKey.toString();
      console.log("Connected with PublicKey:", publicKey);

      // Get or create user
      const user = await getOrCreateUser(publicKey);
      if (user) {
        alert(`Wallet connected! You are ${user.username}`);
      }
    } catch (err) {
      console.error("Phantom connection error:", err);
      alert("Could not connect Phantom wallet.");
    }
  } else {
    alert("Phantom wallet extension not found!");
  }
});

/**
 * Send message (on button click or Enter key)
 */
sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keyup", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

/**
 * Sends a message if slow mode and length checks pass.
 */
async function sendMessage() {
  const userData = JSON.parse(localStorage.getItem("myLivechatUser"));
  if (!userData || !userData.id) {
    // If user not connected, show warning
    showWarning("Please connect your wallet first!", true);
    return;
  }

  let content = chatInput.value.trim();
  if (!content) return;

  // Check max length
  if (content.length > 50) {
    showWarning("Message too long (max 50 chars)!", true);
    return;
  }

  // Check slow mode (compare now vs. user.last_message_at)
  const { data: freshUser, error: fetchError } = await supabase
    .from("users")
    .select("*")
    .eq("id", userData.id)
    .single();

  if (fetchError) {
    console.error("Error fetching user for slow mode:", fetchError);
    return;
  }

  const lastMessageAt = freshUser.last_message_at
    ? new Date(freshUser.last_message_at)
    : null;
  const now = new Date();

  // If lastMessageAt is not null, check time difference
  if (lastMessageAt) {
    const diffInSeconds = (now.getTime() - lastMessageAt.getTime()) / 1000;
    // Updated to 2-second cooldown
    if (diffInSeconds < 2) {
      showWarning("You are too fast! Slow mode is on.", true);
      return;
    }
  }

  // Insert the message
  const { error: insertError } = await supabase
    .from("messages")
    .insert([{ user_id: freshUser.id, content }]);

  if (insertError) {
    console.error("Error sending message:", insertError);
    showWarning("Error sending message!", true);
    return;
  }

  // Update last_message_at
  const { error: updateError, data: updatedUser } = await supabase
    .from("users")
    .update({ last_message_at: now.toISOString() })
    .eq("id", freshUser.id)
    .select()
    .single();

  if (updateError) {
    console.error("Error updating last_message_at:", updateError);
  } else {
    // Update local storage with fresh user info
    localStorage.setItem("myLivechatUser", JSON.stringify(updatedUser));
  }

  // Clear input
  chatInput.value = "";
}

/************************************************************
 * 4. INIT
 ************************************************************/
window.addEventListener("DOMContentLoaded", async () => {
  try {
    // Fetch /config to get environment data
    const configResponse = await fetch("/config");
    const configData = await configResponse.json();

    // Create supabase client
    supabase = window.supabase.createClient(
      configData.SUPABASE_URL,
      configData.SUPABASE_ANON_KEY
    );

    // Load existing messages, subscribe to new
    await fetchExistingMessages();
    subscribeToMessages();
  } catch (err) {
    console.error("Failed to load environment config:", err);
    alert("Could not load environment configuration from server.");
  }
});
