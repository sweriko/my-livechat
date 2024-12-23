// script.js

let supabase; // We'll create it after fetching /config
let messagesSubscription;

/************************************************************
 * 1. HTML ELEMENTS
 ************************************************************/
const connectWalletBtn = document.getElementById("connectWalletBtn");
const messagesList = document.getElementById("messagesList");
const chatContainer = document.getElementById("chatContainer");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

// Slow mode warning text
const slowModeWarning = document.getElementById("slowModeWarning");

/************************************************************
 * 2. HELPER FUNCTIONS
 ************************************************************/

/**
 * Show slow mode warning with shake animation.
 * The warning appears, shakes, and disappears.
 */
function showSlowModeWarning() {
  slowModeWarning.textContent = "You are too fast dude!";
  slowModeWarning.style.display = "block";

  // Add the shake class to trigger animation
  slowModeWarning.classList.add("shake");

  // Remove the shake class after the animation completes (0.3s)
  setTimeout(() => {
    slowModeWarning.classList.remove("shake");
  }, 300); // Matches the animation duration

  // Hide the warning after the animation completes plus a brief pause
  setTimeout(() => {
    slowModeWarning.style.display = "none";
  }, 600); // 300ms animation + 300ms pause
}

/**
 * Generates a random username in the format "UserXXXX"
 * where XXXX is a random 4-digit number.
 */
function generateRandomUsername() {
  const randomId = Math.floor(1000 + Math.random() * 9000);
  return "User" + randomId;
}

/**
 * Retrieves an existing user or creates a new one in the "users" table.
 * @param {string} publicKey - The user's wallet public key.
 * @returns {object|null} - The user object or null if creation failed.
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
 * Adds a new message to the chat UI.
 * @param {string} username - The sender's username.
 * @param {string} content - The message content.
 */
function addMessageToUI(username, content) {
  const li = document.createElement("li");

  const userSpan = document.createElement("span");
  userSpan.textContent = username + ":";
  userSpan.classList.add("username");

  const contentSpan = document.createElement("span");
  contentSpan.textContent = " " + content;

  li.appendChild(userSpan);
  li.appendChild(contentSpan);
  messagesList.appendChild(li);

  // Auto-scroll to the latest message
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Fetches existing messages from Supabase and displays them.
 */
async function fetchExistingMessages() {
  const { data: messages, error } = await supabase
    .from("messages")
    .select("content, created_at, user_id, users(username)")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Error fetching messages:", error);
    return;
  }
  messages.forEach((msg) => {
    addMessageToUI(msg.users.username, msg.content);
  });
}

/**
 * Subscribes to real-time message inserts and updates the UI accordingly.
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
 * Fetches the username for a new message and displays it.
 * @param {object} msgRow - The new message row from Supabase.
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
 * Handles the wallet connection when the "Connect Phantom Wallet" button is clicked.
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
 * Handles sending messages when the "Send" button is clicked or Enter key is pressed.
 */
sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keyup", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

/**
 * Sends a message after validating slow mode restrictions.
 */
async function sendMessage() {
  const userData = JSON.parse(localStorage.getItem("myLivechatUser"));
  if (!userData || !userData.id) {
    // If user is not connected, you might want to show a different warning
    showSlowModeWarning();
    return;
  }

  const content = chatInput.value.trim();
  if (!content) return;

  // 1. Check slow mode (compare now vs. user.last_message_at)
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

  // If lastMessageAt is not null, check the difference
  if (lastMessageAt) {
    const diffInSeconds = (now.getTime() - lastMessageAt.getTime()) / 1000;
    if (diffInSeconds < 5) {
      // Show slow mode warning
      showSlowModeWarning();
      return;
    }
  }

  // 2. Insert message
  const { error: insertError } = await supabase
    .from("messages")
    .insert([{ user_id: freshUser.id, content }]);

  if (insertError) {
    console.error("Error sending message:", insertError);
    return;
  }

  // 3. Update user.last_message_at to now
  const { error: updateError, data: updatedUser } = await supabase
    .from("users")
    .update({ last_message_at: now.toISOString() })
    .eq("id", freshUser.id)
    .select()
    .single();

  if (updateError) {
    console.error("Error updating last_message_at:", updateError);
  } else {
    // Update localStorage
    localStorage.setItem("myLivechatUser", JSON.stringify(updatedUser));
  }

  // 4. Clear input
  chatInput.value = "";
}

/************************************************************
 * 4. INIT
 ************************************************************/
window.addEventListener("DOMContentLoaded", async () => {
  // 1. Fetch /config to get .env data
  try {
    const configResponse = await fetch("/config");
    const configData = await configResponse.json();

    // 2. Create supabase client
    supabase = window.supabase.createClient(
      configData.SUPABASE_URL,
      configData.SUPABASE_ANON_KEY
    );

    // 3. Load existing messages, subscribe to new ones
    await fetchExistingMessages();
    subscribeToMessages();
  } catch (err) {
    console.error("Failed to load environment config:", err);
    alert("Could not load environment configuration from server.");
  }
});
